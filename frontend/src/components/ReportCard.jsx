import React from 'react';
import Icon from './Icon';
import { stages } from '../lib/reportLabels';

// Shared by the feed, my reports, admin review and the watercolor district sheet.
export const speciesNames = { MAPLE: '단풍', GINKGO: '은행', MIXED: '혼합' };
export const statuses = { PENDING_UPLOAD: '사진 저장 중', PENDING_AI: '사진 확인 중', APPROVED: '승인됨', REVIEW: '운영자 검토', REJECTED: '반려됨', UPLOAD_FAILED: '업로드 실패' };
const dateText = x => new Date(x).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ReportCard({ report: r, like, own, children }) {
  return <article className="report-card"><div className="report-photo">{r.photo_url && <img src={r.photo_url} alt={`${r.zone_name} 제보 사진`} loading="lazy"/>}<span className={`status-badge ${r.status.toLowerCase()}`}>{statuses[r.status]}</span></div><div className="report-body"><div className="report-meta"><span>{r.zone_name}</span><small>{dateText(r.created_at)}</small></div><h3>{speciesNames[r.species]} · {stages[r.stage]}</h3><p>{r.description || '오늘의 가을 풍경을 기록했어요.'}</p>{own && r.reason && <p className="report-reason">{r.reason}</p>}<div className="report-bottom"><span>{r.author}</span>{r.status === 'APPROVED' && <button aria-label={`${r.liked ? '좋아요 취소' : '좋아요'} ${r.like_count}`} aria-pressed={r.liked} className={r.liked ? 'like-button liked' : 'like-button'} onClick={() => like?.(r)}><Icon name="heart" size={18}/> {r.like_count}</button>}</div>{children}</div></article>;
}
