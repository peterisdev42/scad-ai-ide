import {CapabilityError} from '../capabilities/CapabilityTypes'
import {reviewLimits,type FeedbackRecord} from './types'
export function boundedReviewSummary<T>(value:T):T{if(Buffer.byteLength(JSON.stringify(value))>reviewLimits.summaryBytes)throw new CapabilityError('SUMMARY_BUDGET','Review evidence exceeds 32 KiB; request fewer records or read the existing report URI. No input was recomputed.');return value}
/** Committed records remain identifiable even if their deep provenance needs a separate read. */
export function feedbackProjection(record:FeedbackRecord){
 const projected={...record,history:record.history.slice(-16).map(({anchor,...event})=>({...event,anchorSnapshotId:anchor?.snapshotId})),historyCount:record.history.length,historyTruncated:record.history.length>16}
 if(Buffer.byteLength(JSON.stringify(projected))<=20000)return projected
 return{schemaVersion:record.schemaVersion,id:record.id,recordRevision:record.recordRevision,ownerUri:undefined,status:record.status,text:record.text,anchor:{reportId:record.anchor.reportId,snapshotId:record.anchor.snapshotId,partId:record.anchor.partId},historyCount:record.history.length,summaryTruncated:true,evidenceOmitted:['full-anchor','history'],createdAt:record.createdAt,updatedAt:record.updatedAt}
}
