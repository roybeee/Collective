"""Signed CS inbox/service reply gateway. No raw inquiry text is exposed."""
import hashlib
import hmac
import json
import time
from consumer_bridge import ConsumerBridge,Rejected,require,UUID,HEX,MAX_BODY
PREFIX='/collective/v1/cs/'

class CsBridge(ConsumerBridge):
    def __init__(self,store,secret,tenant,shop,enabled=False):
        super().__init__(store,secret,tenant,shop,enabled,prefix=PREFIX)
    def handle(self,method,path,headers,raw,now=None):
        if path!=PREFIX+'inbox':return super().handle(method,path,headers,raw,now)
        now=int(time.time()) if now is None else now
        try:
            require(method=='POST',405);require(len(raw)<=MAX_BODY,413);require(self.enabled,409,'disabled')
            stamp,nonce,signature=(headers.get(k,'') for k in ('x-collective-timestamp','x-collective-nonce','x-collective-signature'))
            require(stamp.isdigit() and len(stamp)<=12 and abs(int(stamp)-now)<=300 and UUID.fullmatch(nonce) and HEX.fullmatch(signature),401,'invalid_signature')
            signed=(stamp+'\n'+nonce+'\nPOST\n'+path+'\n').encode()+raw
            require(hmac.compare_digest(hmac.new(self.secret,signed,hashlib.sha256).hexdigest(),signature),401,'invalid_signature')
            b=json.loads(raw);require(isinstance(b,dict) and set(b)=={'tenantId','storeId','cursor','limit'})
            require(b['tenantId']==self.tenant and b['storeId']==self.shop,403,'scope_denied')
            self.store.nonce(self.tenant,self.shop,nonce,now)
            return 200,self.store.inbox(self.tenant,self.shop,b['cursor'],b['limit'])
        except Rejected as e:return e.status,{'status':'rejected','code':e.code}
        except (ValueError,TypeError,UnicodeError):return 400,{'status':'rejected','code':'invalid_request'}
        except Exception:return 503,{'status':'unknown','code':'provider_unavailable'}
