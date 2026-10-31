import { useState } from 'react';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, ReviewSkeleton, Stars, Textarea, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useVendor } from './BusinessApp.jsx';

export default function Reviews() {
  useDocumentTitle('Reviews');
  const { permissions, company } = useVendor();
  const [page, setPage] = useState(1);
  const list = useApi('/vendor/reviews', { query: { page, limit: 10 } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Reviews" subtitle={company.rating.count ? `${company.rating.average.toFixed(1)} average from ${company.rating.count} reviews` : 'Reviews come from customers after a completed booking.'} />
      <p className="mb-4 text-sm text-muted">You can reply publicly. Reviews can't be edited or removed by businesses; report concerns to TownAnt support.</p>
      {list.error && !list.data && <ErrorState error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <ReviewSkeleton />}
      {list.data?.length === 0 && <EmptyState title="No reviews yet" body="Mark appointments as completed so customers can review them." />}
      <div className="flex flex-col gap-3">
        {list.data?.map((r) => (
          <ReviewItem key={r.id} review={r} canReply={permissions.includes('reviews:reply')} onSaved={list.reload} />
        ))}
      </div>
      <Pagination meta={list.meta} onPage={setPage} />
    </div>
  );
}

function ReviewItem({ review, canReply, onSaved }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.vendorReply?.text ?? '');
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    try {
      await api(`/vendor/reviews/${review.id}/reply`, { method: 'PUT', body: { text: text.trim() } });
      setEditing(false);
      onSaved();
      toast('Reply posted');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPending(false);
    }
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-navy">{review.authorName}</span>
        <span className="text-xs text-muted">{relativeTime(review.createdAt)}</span>
      </div>
      <Stars value={review.rating} />
      {review.text && <p className="mt-2 whitespace-pre-line text-sm text-slate">{review.text}</p>}
      {review.vendorReply && !editing && (
        <div className="mt-3 rounded-lg bg-cloud p-3 text-sm">
          <span className="text-xs font-semibold text-muted">Your reply</span>
          <p className="mt-1">{review.vendorReply.text}</p>
        </div>
      )}
      {canReply && !editing && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditing(true)}>
          {review.vendorReply ? 'Edit reply' : 'Reply'}
        </Button>
      )}
      {editing && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea label="Public reply" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" pending={pending} disabled={!text.trim()} onClick={save}>
              Post reply
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
