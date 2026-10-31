import { ArrowDown, ArrowUp, ExternalLink, Megaphone, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { SpotlightCard } from '../../components/SpotlightCard.jsx';
import { Alert, Badge, Button, ConfirmDialog, DetailSkeleton, EmptyState, ErrorState, FormError, Input, ReasonDialog, SearchInput, Spinner, Textarea, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime, imageUrl } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { BannerDropZone, BannerRequirements } from './BannerImage.jsx';
import { ImagePicker, MAX_IMAGE_BYTES, UploadProgress, useImageUpload, useObjectUrl } from './ImagePicker.jsx';
import { AdminPage, Panel } from './kit.jsx';

// Super Admin controls for the public homepage: the hero image and the "In the spotlight" row.
// Every change is validated and audited by the API; this screen only drives it.
export default function Homepage() {
  useDocumentTitle('Homepage');
  return (
    <AdminPage
      width="wide"
      title="Homepage"
      description="The hero image, promotional banner and spotlight placements customers see on the public homepage. Every change is audited."
      actions={
        <a href="/" target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 text-body font-semibold text-slate-800 transition hover:bg-slate-50">
          View homepage <ExternalLink size={15} aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      }
    >
      <SiteManagers />
      <SpotlightManager />
      <Panel
        title="Hero categories"
        description="The hero shows the first five published top-level categories, in sort order, with their uploaded images."
        actions={
          <Link to="/admin/categories" className="text-secondary font-semibold text-teal-700 hover:underline">
            Manage categories
          </Link>
        }
      />
    </AdminPage>
  );
}

// Hero and banner share one settings document; each manager updates it only from the API's answer.
function SiteManagers() {
  const site = useApi('/admin/site');
  if (site.error && !site.data) return <ErrorState compact error={site.error} onRetry={site.reload} title="Homepage settings didn't load" />;
  if (!site.data) return <DetailSkeleton />;
  return (
    <>
      <HeroManager site={site} />
      <BannerManager site={site} maxBytes={site.meta?.uploads?.maxBytes ?? MAX_IMAGE_BYTES} />
    </>
  );
}

const EmptyFrame = ({ children, ratio = 'aspect-[4/3]' }) => <div className={`flex ${ratio} items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-secondary text-slate-500`}>{children}</div>;

// ----- Hero image -----

function HeroManager({ site }) {
  const toast = useToast();
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [takeDown, setTakeDown] = useState(false);
  const { draft, published, publishedAt } = site.data.hero;

  const run = async (key, fn, message) => {
    setPending(key);
    setError(null);
    try {
      const { data } = await fn();
      if (data) site.setData(data);
      toast(message);
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  };

  return (
    <Panel title="Hero image" description="The photo in the homepage hero, beside the headline and search (below them on phones). Replaced from the homepage itself; take it down here. Without a published image the homepage shows TownAnt’s default photo.">
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="hero-live">
          <div className="mb-2 flex items-center gap-2">
            <h3 id="hero-live" className="text-sm font-semibold text-slate-900">
              Live on the homepage
            </h3>
            {published ? <Badge tone="green" dot>Published</Badge> : <Badge>None</Badge>}
          </div>
          {published ? (
            <>
              <HeroPreview hero={published} />
              <p className="mt-2 text-xs text-slate-500">
                {published.alt ? `“${published.alt}”` : 'No description'}
                {publishedAt && ` · published ${formatDateTime(publishedAt)}`}
              </p>
              <Button className="mt-3" size="sm" variant="ghost" onClick={() => setTakeDown(true)}>
                Take down
              </Button>
            </>
          ) : (
            <EmptyFrame>No hero image is published. Customers see TownAnt’s default photo.</EmptyFrame>
          )}
        </section>

        <section aria-labelledby="hero-draft">
          <h3 id="hero-draft" className="mb-2 text-sm font-semibold text-slate-900">
            {draft ? 'Draft (not live yet)' : 'Replace the image'}
          </h3>
          {draft ? (
            <DraftEditor
              draft={draft}
              pending={pending}
              onSave={(meta) => run('save', () => api('/admin/site/hero', { method: 'PATCH', body: meta }), 'Draft updated')}
              onPublish={() => run('publish', () => api('/admin/site/hero/publish', { method: 'POST' }), 'Hero image published')}
              onDiscard={() => run('discard', () => api('/admin/site/hero/draft', { method: 'DELETE' }), 'Draft discarded')}
            />
          ) : (
            <div className="flex h-full flex-col justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6">
              <p className="text-[0.875rem] font-semibold text-slate-900">The hero image is edited on the homepage itself</p>
              <p className="text-[0.8125rem] text-slate-600">Open the homepage while signed in here and choose “Edit hero image” on the photo. It publishes to this same record; the promotional banner below is managed separately.</p>
              <div>
                <a href="/?edit=hero" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-teal px-3 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-teal-700">
                  Edit on the homepage <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="mt-4">
        <FormError error={error} />
      </div>
      <ReasonDialog
        open={takeDown}
        onClose={() => setTakeDown(false)}
        title="Take down the hero image?"
        description="The homepage immediately falls back to TownAnt’s default photo. You can publish a new image at any time."
        confirmLabel="Take down"
        danger
        onConfirm={async (reason) => {
          const { data } = await api('/admin/site/hero/unpublish', { method: 'POST', body: { reason } });
          site.setData(data);
          toast('Hero image taken down');
        }}
      />
    </Panel>
  );
}

function HeroPreview({ hero, src }) {
  return (
    <img
      src={src ?? imageUrl(hero.image.url, { w: 900, h: 675 })}
      alt=""
      width={900}
      height={675}
      style={{ objectPosition: `${hero.focal?.x ?? 50}% ${hero.focal?.y ?? 50}%` }}
      className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200"
    />
  );
}

function FocalControls({ value, onChange }) {
  return (
    <fieldset className="grid grid-cols-2 gap-3 text-sm">
      <legend className="mb-1 text-sm font-medium text-slate-900">Focus point</legend>
      {[
        ['x', 'Horizontal'],
        ['y', 'Vertical'],
      ].map(([k, label]) => (
        <label key={k} className="flex flex-col gap-1 text-slate-500">
          {label} ({value[k]}%)
          <input type="range" min={0} max={100} step={5} value={value[k]} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })} className="accent-teal" />
        </label>
      ))}
    </fieldset>
  );
}

function DraftEditor({ draft, pending, onSave, onPublish, onDiscard }) {
  const [alt, setAlt] = useState(draft.alt);
  const [focal, setFocal] = useState(draft.focal);
  const dirty = alt !== draft.alt || focal.x !== draft.focal.x || focal.y !== draft.focal.y;
  return (
    <div className="flex flex-col gap-3">
      <HeroPreview hero={{ ...draft, focal }} />
      <Input label="Image description" required maxLength={140} value={alt} onChange={(e) => setAlt(e.target.value)} hint="Describe the photo for screen-reader users." />
      <FocalControls value={focal} onChange={setFocal} />
      {!draft.alt && !dirty && <Alert tone="warn">Add an image description before publishing.</Alert>}
      <div className="flex flex-wrap gap-2">
        {dirty ? (
          <Button size="sm" pending={pending === 'save'} disabled={!alt.trim()} onClick={() => onSave({ alt: alt.trim(), focalX: focal.x, focalY: focal.y })}>
            Save draft changes
          </Button>
        ) : (
          <Button size="sm" pending={pending === 'publish'} disabled={!draft.alt} onClick={onPublish}>
            Publish to homepage
          </Button>
        )}
        <Button size="sm" variant="ghost" pending={pending === 'discard'} onClick={onDiscard}>
          Discard draft
        </Button>
      </div>
    </div>
  );
}

// ----- Promotional banner -----

const BANNER_EMPTY = { alt: '', title: '', description: '', linkUrl: '', linkLabel: '' };
const validLink = (v) => !v || /^\/(?![/\\])\S*$/.test(v) || /^https:\/\/\S+$/i.test(v);

// Published directly: choose an image, check the preview, publish. Title, text and link are optional.
function BannerManager({ site, maxBytes }) {
  const toast = useToast();
  const banner = site.data.banner;
  const [file, setFile] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [form, setForm] = useState(() => (banner ? { alt: banner.alt, title: banner.title ?? '', description: banner.description ?? '', linkUrl: banner.link?.url ?? '', linkLabel: banner.link?.label ?? '' } : BANNER_EMPTY));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const upload = useImageUpload();
  const preview = useObjectUrl(file);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const linkError = !validLink(form.linkUrl.trim()) ? 'Use a site path starting with / or a full https:// link.' : form.linkLabel.trim() && !form.linkUrl.trim() ? 'Add a link for the button text, or clear the button text.' : undefined;
  const textDirty = banner && (form.alt !== banner.alt || form.title !== (banner.title ?? '') || form.description !== (banner.description ?? '') || form.linkUrl !== (banner.link?.url ?? '') || form.linkLabel !== (banner.link?.label ?? ''));
  const fields = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));

  const publish = async () => {
    setError(null);
    try {
      const data = await upload.run('/admin/site/banner', file, fields);
      site.setData(data);
      setFile(null);
      toast(banner ? 'Banner replaced. The new one is live on the homepage.' : 'Banner published. It is live on the homepage.');
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
    }
  };
  const saveText = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await api('/admin/site/banner', { method: 'PATCH', body: fields });
      site.setData(data);
      toast('Banner updated');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const shown = preview ? { image: { url: preview, local: true } } : banner;
  return (
    <Panel
      title="Promotional banner"
      description="Shown directly below “New and noteworthy” on the homepage, at a fixed 3:1 shape. Published directly — no draft. An image alone is enough; title, text and link are optional."
      actions={banner ? <Badge tone="green" dot>Published{banner.publishedAt ? ` ${formatDateTime(banner.publishedAt)}` : ''}</Badge> : <Badge>Not published</Badge>}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Banner image" className="flex min-w-0 flex-col gap-4">
          <BannerRequirements maxBytes={maxBytes} />
          {shown && (
            <div className="flex flex-col gap-2">
              <p className="text-[0.8125rem] font-semibold text-slate-900">{file ? 'Preview — not live until you publish' : 'Live on the homepage'}</p>
              <BannerPreview banner={shown} text={fields} />
            </div>
          )}
          <UploadProgress progress={upload.progress} onCancel={upload.cancel} prepared={file ? prepared : null} />
          {file ? (
            <div className="flex flex-wrap gap-2">
              <Button pending={upload.pending} disabled={Boolean(linkError)} onClick={publish}>
                {banner ? 'Publish replacement' : 'Publish banner'}
              </Button>
              <Button variant="secondary" disabled={upload.pending} onClick={() => setFile(null)}>
                Choose a different image
              </Button>
            </div>
          ) : (
            <>
              <BannerDropZone
                disabled={upload.pending}
                onAccept={(f, info) => {
                  setError(null);
                  setFile(f);
                  setPrepared(info);
                }}
              />
              {banner && (
                <div>
                  <Button size="sm" variant="danger-ghost" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setRemoving(true)}>
                    Remove banner
                  </Button>
                </div>
              )}
              {!banner && (
                <p className="flex items-center gap-2 text-caption text-slate-500">
                  <Megaphone size={14} aria-hidden="true" /> No banner is published, so the homepage shows nothing in this spot.
                </p>
              )}
            </>
          )}
        </section>
        <section aria-label="Banner text and link" className="flex flex-col gap-3">
          <Input label="Image description" optional maxLength={140} value={form.alt} onChange={set('alt')} hint="For screen-reader users. Recommended." />
          <Input label="Title" optional maxLength={80} value={form.title} onChange={set('title')} />
          <Textarea label="Text" optional rows={2} maxLength={200} value={form.description} onChange={set('description')} hint="Factual only — no prices or offers TownAnt can't honour." />
          <Input label="Link" optional maxLength={300} placeholder="/search?category=cleaning" value={form.linkUrl} onChange={set('linkUrl')} error={linkError} hint="A page on TownAnt (starts with /) or an https:// address." />
          <Input label="Button text" optional maxLength={40} value={form.linkLabel} onChange={set('linkLabel')} hint="Without it, the whole banner is the link." />
          {banner && !file && (
            <div>
              <Button size="sm" variant="secondary" pending={saving} disabled={!textDirty || Boolean(linkError)} onClick={saveText}>
                Save text and link
              </Button>
            </div>
          )}
        </section>
      </div>
      <div className="mt-4">
        <FormError error={error ?? upload.error} />
      </div>
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        danger
        title="Remove the promotional banner?"
        description="It disappears from the homepage straight away and its image is deleted. You can publish a new banner at any time."
        confirmLabel="Remove banner"
        onConfirm={async () => {
          const { data } = await api('/admin/site/banner', { method: 'DELETE' });
          site.setData(data);
          setForm(BANNER_EMPTY);
          toast('Banner removed');
        }}
      />
    </Panel>
  );
}

// Mirrors the public homepage banner so admins see what customers will see.
function BannerPreview({ banner, text }) {
  const src = banner.image.local ? banner.image.url : imageUrl(banner.image.url, { w: 1200, crop: 'limit' });
  const hasText = text.title || text.description || (text.linkLabel && text.linkUrl);
  return (
    <div className="overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
      <img src={src} alt="" width={1200} height={400} className="block aspect-[3/1] w-full object-cover" />
      {hasText && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3">
          <div className="min-w-0">
            {text.title && <p className="font-heading font-bold text-slate-900">{text.title}</p>}
            {text.description && <p className="text-secondary text-slate-600">{text.description}</p>}
          </div>
          {text.linkLabel && text.linkUrl && <span className="rounded-md bg-slate-900 px-3 py-1.5 text-secondary font-semibold text-white">{text.linkLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ----- Spotlight -----

function SpotlightManager() {
  const list = useApi('/admin/spotlight');
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => setOrder(null), [list.data]);
  const rows = order ?? list.data ?? [];
  const dirty = order !== null;

  const move = (i, dir) => {
    const next = [...rows];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setOrder(next);
  };

  const act = async (key, fn, message) => {
    setPending(key);
    setError(null);
    try {
      await fn();
      toast(message);
      list.reload();
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  };

  const placedIds = new Set((list.data ?? []).map((c) => c.id));
  const visible = rows.filter((c) => c.visible);

  return (
    <Panel
      title="In the spotlight"
      description="Businesses featured on the homepage, in this order. Only published businesses are shown; the row is hidden when none are."
      actions={
        dirty && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOrder(null)}>
              Reset
            </Button>
            <Button size="sm" pending={pending === 'order'} onClick={() => act('order', () => api('/admin/spotlight/order', { method: 'PUT', body: { ids: rows.map((c) => c.id) } }), 'Spotlight order saved')}>
              Save order
            </Button>
          </div>
        )
      }
    >
      <div>
        {list.error && !list.data ? (
          <ErrorState compact error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState compact title="Nothing in the spotlight" body="Search for a published business below to feature it." />
        ) : (
          <ol className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
            {rows.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 p-3">
                <span className="w-6 text-center text-sm font-semibold text-slate-500 tabular">{i + 1}</span>
                <span className="size-12 shrink-0 overflow-hidden rounded-md bg-slate-50 ring-1 ring-slate-200">{(c.cover ?? c.logo) && <img src={imageUrl((c.cover ?? c.logo).url, { w: 96, h: 96 })} alt="" className="size-full object-cover" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">{c.spotlight.headline || c.name}</span>
                  <span className="block truncate text-xs text-slate-500">{[c.spotlight.headline && c.name, c.category?.name, c.location?.city].filter(Boolean).join(' · ')}</span>
                </span>
                {c.visible ? <Badge tone="teal">Visible</Badge> : <Badge tone="amber">Hidden · {c.status}</Badge>}
                <div className="flex items-center">
                  <IconButton label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={16} />
                  </IconButton>
                  <IconButton label={`Move ${c.name} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={16} />
                  </IconButton>
                  <Link to={`/admin/companies/${c.id}`} className="flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-900" aria-label={`Edit spotlight text for ${c.name}`} title="Edit headline and text">
                    <ExternalLink size={16} aria-hidden="true" />
                  </Link>
                  <IconButton label={`Remove ${c.name} from the spotlight`} disabled={dirty || pending === c.id} onClick={() => act(c.id, () => api(`/admin/companies/${c.id}/spotlight`, { method: 'PUT', body: { active: false } }), `${c.name} removed from the spotlight`)}>
                    <X size={16} />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        )}
        {dirty && <p className="mt-2 text-xs text-amber-text">Order changed — save to apply it on the homepage.</p>}
      </div>

      <FormError error={error} />

      <AddToSpotlight placedIds={placedIds} disabled={dirty} onAdd={(c) => act(`add-${c.id}`, () => api(`/admin/companies/${c.id}/spotlight`, { method: 'PUT', body: { active: true } }), `${c.name} added to the spotlight`)} pending={pending} />

      {visible.length > 0 && (
        <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="spotlight-preview">
          <h3 id="spotlight-preview" className="mb-3 text-sm font-semibold text-slate-900">
            Preview
          </h3>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {visible.map((c) => (
              <div key={c.id} className="w-[320px] shrink-0">
                <SpotlightCard company={c} />
              </div>
            ))}
          </div>
        </section>
      )}
    </Panel>
  );
}

function IconButton({ label, children, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} className="flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent" {...props}>
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

function AddToSpotlight({ placedIds, onAdd, pending, disabled }) {
  const [q, setQ] = useState('');
  const results = useApi('/admin/companies', { query: { q, status: 'published', limit: 6 }, enabled: q.trim().length >= 2 });
  return (
    <section className="mt-5" aria-labelledby="spotlight-add">
      <h3 id="spotlight-add" className="mb-2 text-sm font-semibold text-slate-900">
        Add a business
      </h3>
      <SearchInput label="Search published businesses" labelHidden={false} value={q} onDebouncedChange={setQ} loading={results.loading} placeholder="Business name, link name or city" />
      {q.trim().length >= 2 && results.data && (
        <ul className="mt-2 flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
          {results.data.length === 0 && <li className="p-3 text-sm text-slate-500">No published businesses match.</li>}
          {results.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-900">{c.name}</span>
                <span className="block truncate text-xs text-slate-500">{[c.address?.city, c.address?.country].filter(Boolean).join(', ')}</span>
              </span>
              {placedIds.has(c.id) ? (
                <Badge tone="teal">In spotlight</Badge>
              ) : (
                <Button size="sm" variant="secondary" disabled={disabled} pending={pending === `add-${c.id}`} icon={<Plus size={15} aria-hidden="true" />} onClick={() => onAdd(c)}>
                  Add
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
