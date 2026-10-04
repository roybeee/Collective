"""Run behind a TLS reverse proxy; one process/service per owner and durable SQLite path."""
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from .core import Gateway,MAX_BODY,canonical,require
from .providers import OpenAIProvider,SignedFixedProvider

class GatewayServer(ThreadingHTTPServer):
 daemon_threads=True
 def __init__(self,address,gateway):
  self.gateway=gateway;self.slots=threading.BoundedSemaphore(8);super().__init__(address,Handler)
 def process_request(self,request,address):
  if not self.slots.acquire(blocking=False):
   request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');self.shutdown_request(request);return
  super().process_request(request,address)
 def process_request_thread(self,request,address):
  try:super().process_request_thread(request,address)
  finally:self.slots.release()

class Handler(BaseHTTPRequestHandler):
 server_version='EvalGateway/1'
 def log_message(self,*args):pass
 def do_GET(self):self.dispatch()
 def do_POST(self):self.dispatch()
 def dispatch(self):
  status,value=400,{'error':'invalid_http_request'}
  try:
   self.connection.settimeout(5)
   for name in ('authorization','x-collective-owner','content-type','content-length'):
    require(len(self.headers.get_all(name,[]))<=1,'duplicate_header',400)
   require(not self.headers.get('transfer-encoding') and '?' not in self.path,'invalid_framing',400)
   length=int(self.headers.get('content-length','0'));require(0<=length<=MAX_BODY,'body_limit',413)
   require(self.command!='POST' or self.headers.get('content-length') is not None,'length_required',411)
   raw=self.rfile.read(length);require(len(raw)==length,'short_body',400)
   headers={k.lower():v for k,v in self.headers.items()};status,value=self.server.gateway.handle(self.command,self.path,headers,raw)
  except (ValueError,socket.timeout):pass
  except Exception as e:status=getattr(e,'status',400);value={'error':getattr(e,'code','invalid_http_request')}
  result=canonical(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(result)));self.send_header('Connection','close');self.end_headers()
  try:self.wfile.write(result)
  except (BrokenPipeError,ConnectionResetError):pass

def configured_gateway(env=os.environ):
 def needed(key):
  value=env.get(key,'');require(bool(value),'missing_'+key);return value
 mode=needed('EVAL_GATEWAY_PROVIDER')
 if mode=='signed_fixed':
  provider=SignedFixedProvider(needed('EVAL_UPSTREAM_ORIGIN'),needed('EVAL_UPSTREAM_TOKEN'),needed('EVAL_UPSTREAM_TRUST_KEY'),needed('EVAL_UPSTREAM_OWNER'),needed('EVAL_UPSTREAM_CONTRACT_ID'),needed('EVAL_UPSTREAM_MODEL'))
 elif mode=='openai_usd_diagnostic':provider=OpenAIProvider(needed('OPENAI_API_KEY'))
 else:raise ValueError('unsupported_provider')
 path=needed('EVAL_GATEWAY_DB');require(os.path.isabs(path),'absolute_persistent_db_required')
 os.umask(0o077)
 return Gateway(path,provider,needed('EVAL_GATEWAY_TOKEN'),int(needed('EVAL_GATEWAY_CAP_KRW')),needed('EVAL_GATEWAY_OWNER'),needed('EVAL_GATEWAY_SIGNING_KEY'))

if __name__=='__main__':
 GatewayServer(('127.0.0.1',int(os.environ.get('EVAL_GATEWAY_PORT','8798'))),configured_gateway()).serve_forever()
