#!/usr/bin/env python3
"""Explicit installation/readiness commands; never implicitly migrates or sends."""
import argparse
import importlib
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request
from integration import Integration, READY_PATH, SECTIONS, secret, validate_manifest


def load_manifest(path):
    raw=pathlib.Path(path).read_bytes()
    if len(raw)>65536:raise ValueError('configuration_invalid')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('configuration_invalid')
            result[key]=value
        return result
    return validate_manifest(json.loads(raw,object_pairs_hook=unique))


def load_factory(spec,manifest):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]*:[A-Za-z_][A-Za-z0-9_]*',spec or ''):raise ValueError('factory_required')
    module,attribute=spec.split(':');factory=getattr(importlib.import_module(module),attribute)
    app=factory(manifest)
    if not isinstance(app,Integration):raise ValueError('integration_factory_required')
    return app


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        raise ValueError('redirect_rejected')


def verify_remote(origin,manifest,env):
    if origin not in {'https://mapdal.kr','https://www.mapdal.kr'}:raise ValueError('origin_rejected')
    token=secret(env,manifest['readinessTokenEnv'])
    req=urllib.request.Request(origin+READY_PATH,headers={'Authorization':'Bearer '+token,'Accept':'application/json'},method='GET')
    opener=urllib.request.build_opener(NoRedirect)
    with opener.open(req,timeout=10) as result:
        if result.status!=200:raise ValueError('not_ready')
        raw=result.read(16385)
    if len(raw)>16384:raise ValueError('response_too_large')
    value=json.loads(raw)
    expected={name for name in SECTIONS if manifest.get(name,{}).get('enabled')}
    if not isinstance(value,dict) or value.get('status')!='ready' or not isinstance(value.get('capabilities'),dict):raise ValueError('not_ready')
    if set(value['capabilities'])!=SECTIONS:raise ValueError('capability_mismatch')
    if any(value['capabilities'][name]!=('ready' if name in expected else 'disabled') for name in SECTIONS):raise ValueError('capability_mismatch')
    return {'status':'ready','capabilities':{name:value['capabilities'][name] for name in sorted(SECTIONS)}}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['plan','check','migrate','verify'])
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--factory',help='Trusted local module:function returning an inert Integration from manifest')
    parser.add_argument('--confirm-additive-migrations',action='store_true')
    parser.add_argument('--origin',choices=['https://mapdal.kr','https://www.mapdal.kr'],default='https://mapdal.kr')
    args=parser.parse_args(argv)
    try:
        manifest=load_manifest(args.manifest)
        if args.command=='plan':
            result={'status':'planned','capabilities':{name:'enabled' if manifest.get(name,{}).get('enabled') else 'disabled' for name in sorted(SECTIONS)},'database':'not_accessed','network':'not_called'}
        elif args.command=='verify':result=verify_remote(args.origin,manifest,os.environ)
        elif args.command=='migrate':
            if not args.confirm_additive_migrations:raise ValueError('explicit_migration_confirmation_required')
            result=load_factory(args.factory,manifest).migrate()
        else:result=load_factory(args.factory,manifest).check(require_ready=False)
        print(json.dumps(result,sort_keys=True,separators=(',',':')))
        return 0 if result['status'] in {'ready','planned'} else 1
    except Exception:
        # Import errors, schema/driver exceptions and remote response bodies may
        # contain DSNs or customer fields. Only a fixed error crosses the CLI.
        print(json.dumps({'status':'unavailable','code':'installation_check_failed'}))
        return 1


if __name__=='__main__':sys.exit(main())
