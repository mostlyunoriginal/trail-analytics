"""Refresh public weather, snow, source catalog and agency-notice snapshots.

Network acquisition is separate from the offline build. Failed sources retain their
previous data AND previous timestamps; failure is never represented as no alerts.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import math
import os
import hashlib
from html.parser import HTMLParser
from pathlib import Path
import urllib.parse
import urllib.request

AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/"
TNM = "https://tnmaccess.nationalmap.gov/api/v1/products"


class AgencyLinks(HTMLParser):
    def __init__(self, url):
        super().__init__(); self.base=url; self.current=None; self.links=[]
    def handle_starttag(self, tag, attrs):
        if tag=='a': self.current=[dict(attrs).get('href',''),[]]
    def handle_data(self, data):
        if self.current: self.current[1].append(data)
    def handle_endtag(self, tag):
        if tag=='a' and self.current:
            href,parts=self.current; text=' '.join(' '.join(parts).split()); url=urllib.parse.urljoin(self.base,href)
            if urllib.parse.urlparse(url).hostname=='www.fs.usda.gov' and any(k in (text+' '+url).lower() for k in ('closure','restriction','order','alert','motor vehicle')):
                self.links.append({'title':text or 'Agency document','url':url})
            self.current=None


def agency_pages(sources):
    out=[]
    for source in sources:
        req=urllib.request.Request(source['url'],headers={'User-Agent':'trail-analytics/0.2 public trail planning'})
        try:
            with urllib.request.urlopen(req,timeout=25) as response: body=response.read()
            parser=AgencyLinks(source['url']); parser.feed(body.decode('utf-8','replace'))
            # Document discovery is not a finding that any order applies to this route.
            out.append({**source,'fetched_at':datetime.now(timezone.utc).isoformat(),'sha256':hashlib.sha256(body).hexdigest(),
                        'documents':list({x['url']:x for x in parser.links}.values())[:50], 'status':'retrieved; applicability unreviewed'})
        except Exception as e:
            out.append({**source,'fetched_at':None,'status':'unavailable','error':str(e),'documents':[]})
    return out


def get(url, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent":"trail-analytics/0.2 (public trail planning)","Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=35) as r:
        return json.load(r)


def save(path, value):
    tmp=path.with_suffix(".tmp.json")
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf-8")
    os.replace(tmp,path)


def weather_point(p):
    loc=f"{p['lat']:.4f},{p['lon']:.4f}"
    info=get("https://api.weather.gov/points/"+loc)["properties"]
    forecast=get(info["forecast"])
    # Forecast succeeds independently of the alerts endpoint.
    result={"label":p["label"],"lat":p["lat"],"lon":p["lon"],"elevation_m":p["z"],
            "source_url":"https://forecast.weather.gov/MapClick.php?lat="+str(p["lat"])+"&lon="+str(p["lon"]),
            "fetched_at":datetime.now(timezone.utc).isoformat(),"updated":forecast["properties"].get("updated"),
            "periods":forecast["properties"]["periods"]}
    try:
        result["alerts"]=get("https://api.weather.gov/alerts/active",{"point":loc})["features"]
    except Exception as e:
        result["alerts"]=None; result["alerts_error"]=str(e)
    return result


def snow(center, state="CO"):
    stations=get(AWDB+"stations",{"stationTriplets":f"*:{state}:SNTL","activeOnly":"true"})
    def km(s):
        return math.hypot((s["latitude"]-center["lat"])*111.32,
                          (s["longitude"]-center["lon"])*111.32*math.cos(math.radians(center["lat"])))
    nearest=sorted(stations,key=km)[:3]
    data=get(AWDB+"data",{"stationTriplets":",".join(s["stationTriplet"] for s in nearest),
                         "elements":"WTEQ,SNWD","duration":"DAILY","beginDate":"-7","endDate":"0","returnSuspectData":"false"})
    by_id={s["stationTriplet"]:s for s in data}
    return [{"station":s,"distance_km":round(km(s),1),"data":by_id.get(s["stationTriplet"],{}),
             "fetched_at":datetime.now(timezone.utc).isoformat(),
             "source_url":"https://wcc.sc.egov.usda.gov/nwcc/site?sitenum="+s["stationTriplet"].split(":")[0]}
            for s in nearest]


def catalog(bbox):
    result=get(TNM,{"bbox":",".join(str(x) for x in bbox),"datasets":"Digital Elevation Model (DEM) 1 meter","max":100})
    return {"fetched_at":datetime.now(timezone.utc).isoformat(),"source_url":TNM,"bbox":bbox,
            "total":result.get("total"),"products":[{k:x.get(k) for k in ("sourceId","title","publicationDate","lastUpdated","downloadURL","metaUrl","boundingBox","format","sizeInBytes")}
             for x in result.get("items",[])],
            "usage":"Catalog candidates, not the provenance of the cached mosaic. Pin a selected product before replacing the DEM."}


def refresh(trail):
    trail=Path(trail); raw=trail/"raw"
    pointer=trail/"derived/viewer/current.json"
    dv=pointer.parent/json.loads(pointer.read_text())["path"] if pointer.exists() else pointer.parent
    routes=json.loads((dv/"routes.json").read_text())
    points=[p for r in routes for p in json.loads((dv/r["file"]).read_text())]
    selection=[("Lowest route elevation",min(points,key=lambda p:p["z"])),("Highest route elevation",max(points,key=lambda p:p["z"]))]
    for r in routes:
        if r.get("role")=="primary":
            p=json.loads((dv/r["file"]).read_text()); selection += [("Primary start",p[0]),("Primary end",p[-1])]
    center={k:sum(p[k] for p in points)/len(points) for k in ("lon","lat")}
    bbox=[min(p["lon"] for p in points),min(p["lat"] for p in points),max(p["lon"] for p in points),max(p["lat"] for p in points)]
    previous=json.loads((raw/"conditions.json").read_text(encoding="utf-8")) if (raw/"conditions.json").exists() else {}
    result={**previous,"attempted_at":datetime.now(timezone.utc).isoformat(),"errors":[],"weather":[],
            "notices":previous.get("notices",[])}
    tasks={f"weather:{label}":(lambda label=label,p=p: weather_point({**p,"label":label})) for label,p in selection}
    manifest=json.loads((trail/"trail.json").read_text(encoding="utf-8"))
    tasks["snow"]=lambda:snow(center,manifest.get("state","CO")); tasks["catalog"]=lambda:catalog(bbox)
    tasks["agency_pages"]=lambda:agency_pages(manifest.get('agency_sources',[]))
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures={k:pool.submit(fn) for k,fn in tasks.items()}
        for k,f in futures.items():
            try:
                value=f.result()
                if k.startswith("weather:"): result["weather"].append(value)
                elif k=="catalog": save(raw/"source-catalog.json",value)
                else: result[k]=value
                print(k,"OK")
            except Exception as e:
                result["errors"].append({"source":k,"error":str(e)})
                if k.startswith("weather:"):
                    result["weather"] += [p for p in previous.get("weather",[]) if p["label"]==k.split(":",1)[1]]
                print(k,"FAILED",str(e))
    # Orders need human/agent review of geographic applicability; never infer 'open'
    # from an empty feed, a successful page fetch, or a missing restriction.
    result["agency_review"]={"status":"unverified","checked_at":None,
                             "sources":manifest.get("agency_sources",[]),
                             "message":"Review current orders and district notices for this route and trip date."}
    notices=raw/'agency-notices.json'
    if notices.exists():result['notices']=json.loads(notices.read_text(encoding='utf-8'))
    save(raw/"conditions.json",result)
    return result


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("trail",nargs="?",default="data/bunce-school-road")
    refresh(p.parse_args().trail)
