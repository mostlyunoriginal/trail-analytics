import importlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/pipeline'))
import enhance
import build_viewer_assets as base


class PipelineTests(unittest.TestCase):
    def test_access_restriction_is_not_erased_by_nearby_mvum(self):
        ways=[{'id':1,'tags':{'motor_vehicle':'no'},'coords':[(0,0),(0,.001)]}]
        mvum=[{'id':'216.1','coords':[(0,0),(0,.001)]}]
        self.assertEqual(enhance.access_for((0,.0005),ways,mvum,['216.1'])['status'],'conflict')

    def test_unrelated_mvum_does_not_establish_access(self):
        ways=[{'id':1,'tags':{},'coords':[(0,0),(0,.001)]}]
        mvum=[{'id':'different-road','coords':[(0,0),(0,.001)]}]
        self.assertEqual(enhance.access_for((0,.0005),ways,mvum,['216.1'])['status'],'unverified')

    def test_nearby_media_is_not_verified_coverage(self):
        self.assertFalse(enhance.media_covers({'type':'youtube','start_seconds':10},'obstacle'))
        self.assertFalse(enhance.media_covers({'type':'youtube','coverage_verified':True,'target_ids':['obstacle']},'obstacle'))
        self.assertTrue(enhance.media_covers({'type':'youtube','start_seconds':0,'coverage_verified':True,'target_ids':['obstacle']},'obstacle'))

    def test_short_final_profile_step_has_finite_grade(self):
        grid=np.arange(100,dtype=float).reshape(10,10)
        p=base.build_profile([(0,0),(0,100.1/111320)],grid,(-.001,-.001,.001,.002))
        self.assertEqual(p[-1]['d'],100.1)
        self.assertTrue(all(b['d']>a['d'] for a,b in zip(p,p[1:])))
        self.assertTrue(all(np.isfinite(q['g']) and 'raw_z' in q for q in p))

    def test_overview_and_tiles_preserve_plane(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp);grid=np.add.outer(np.arange(300)*2,np.arange(350)*3).astype('f4')
            meta=enhance.terrain_assets(out,grid,{})
            small=np.fromfile(out/'overview.bin',dtype='<f4').reshape(257,257)
            self.assertAlmostEqual(float(small[128,128]),299+349*1.5,places=3)
            t1=np.fromfile(out/'terrain/0-0.bin',dtype='<f4').reshape(257,257)
            t2=np.fromfile(out/'terrain/256-0.bin',dtype='<f4').reshape(257,94)
            np.testing.assert_array_equal(t1[:,-1],t2[:,0])

    def test_offline_missing_dem_never_calls_network(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(base.urllib.request,'urlopen',side_effect=AssertionError('network')):
            with self.assertRaises(FileNotFoundError):base.fetch_dem(Path(tmp),(0,0,1,1),10,10,offline=True)

    def test_invalid_dem_keeps_previous_pointer(self):
        root=Path(__file__).resolve().parents[1]/'data/bunce-school-road'
        pointer=root/'derived/viewer/current.json';before=pointer.read_bytes()
        with patch.object(base,'fetch_dem',return_value=np.full((1,1),np.nan)):
            with self.assertRaises(ValueError):enhance.build(root)
        self.assertEqual(pointer.read_bytes(),before)

    def test_published_release_integrity(self):
        root=Path(__file__).resolve().parents[1]/'data/bunce-school-road/derived/viewer'
        release=root/json.loads((root/'current.json').read_text())['path']
        for name,info in json.loads((release/'inventory.json').read_text()).items():
            p=release/name;self.assertEqual(p.stat().st_size,info['bytes']);self.assertEqual(enhance.digest(p),info['sha256'])
        routes=json.loads((release/'routes.json').read_text())
        lateral=next(r for r in routes if r['id']=='ironclads-lateral')
        self.assertEqual(lateral['access_status'],'conflict')
        self.assertTrue(lateral['notes'])


if __name__=='__main__':unittest.main()
