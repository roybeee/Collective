'use client';
import {Note} from '@/components/app/note';
import {Button} from '@/components/ui/button';
import type {GrowthOperationReview,OperationReviewItem} from '@/lib/growth-operation-review';

type Props={review:GrowthOperationReview;onOpen:(target:OperationReviewItem['target'])=>void;disabled?:boolean;stale?:boolean};
const actions:Record<OperationReviewItem['target']['kind'],string>={order_link:'품목 연결 열기',line_reconcile:'품목 대사 열기',line_operation:'이행 기록 열기',inventory:'재고 기록 열기'};
function name(row:OperationReviewItem){return row.lineId?`품목 ${row.lineId}`:row.orderId?`주문 ${row.orderId}`:`공유 재고 ${row.inventoryId}`}
function quantity(row:OperationReviewItem){if(row.heldUnits===null)return '미출고 할당 미확인';return `미출고 할당 ${row.heldUnits.toLocaleString('ko-KR')}${row.unit==='piece'?'개':row.unit==='pack'?'팩':' (단위 미확인)'}`}
export function GrowthOperationReviewView({review,onOpen,disabled=false,stale=false}:Props){
 return <section aria-label="운영 확인 목록" className="min-w-0 space-y-3 rounded-lg border p-3 text-sm">
  <div><h3 className="font-semibold">운영 확인 목록</h3><Note className="text-muted-foreground">현재 캠페인의 주문·품목과 연결된 공유 재고를 확인합니다. 목록 순서는 대사·할당 확인이 필요한 항목 우선이며 배송 지연이나 자동 해제를 뜻하지 않습니다.</Note></div>
  <p className="break-words text-xs text-muted-foreground">조회 시각: {review.evaluatedAt} · 실제 처리는 기존 양식에서 별도로 확인합니다.</p>
  {stale&&<p role="status" className="text-amber-700">이전 조회 결과입니다. 최신 운영 기록 조회에 성공한 뒤 기록을 여세요.</p>}
  {disabled&&!stale&&<p className="text-amber-700">미저장 입력 또는 저장 중인 작업이 있어 기록 이동을 잠갔습니다. 입력을 저장하거나 명시적으로 변경을 취소하세요.</p>}
  {!review.items.length&&<p>현재 조회에서 확인이 필요한 항목이 없습니다. 전체 운영 완료나 배송 완료를 의미하지 않습니다.</p>}
  <div className="grid min-w-0 gap-3 md:grid-cols-2">{review.items.map(row=><article key={row.key} aria-label={name(row)} className="min-w-0 space-y-2 rounded-md border p-3 [overflow-wrap:anywhere]">
   <h4 className="font-medium">{row.lineId?'품목 확인':row.orderId?'현재 캠페인 품목 연결 없음':'공유 원장 확인'}</h4>
   {row.orderId&&<p>원 주문 ID: {row.orderId}</p>}{row.lineId&&<p>성장 품목 ID: {row.lineId}</p>}{row.inventoryId&&<p>공유 재고 ID: {row.inventoryId}</p>}
   {row.lineId&&<p>{quantity(row)}</p>}
   <ul className="list-disc space-y-1 pl-4">{row.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>
   <Button type="button" variant="outline" size="fit" disabled={disabled||stale} onClick={()=>onOpen(row.target)}>{actions[row.target.kind]}</Button>
  </article>)}</div>
  <p className="text-xs text-muted-foreground">수량·금액·해제 가능량을 추정하지 않습니다. 공유 원장 부족은 이 캠페인만의 부족량이 아니며, 취소·부분 환불만으로 안전 해제를 확정하지 않습니다.</p>
 </section>;
}
