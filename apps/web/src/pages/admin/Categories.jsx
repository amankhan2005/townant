import { ArrowLeft, Eye, EyeOff, ImageOff, Pencil, Plus, Store, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Badge, Button, DetailSkeleton, ErrorState, FormError, Input, Modal, SearchInput, Select, Textarea, Toggle, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { formatDate, imageUrl } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { CATEGORY_ICON_KEYS } from '../../lib/icons.js';
import { ImagePicker, UploadProgress, useImageUpload, useObjectUrl } from './ImagePicker.jsx';
import { AdminPage, DataPanel, ExportButton, FactList, Panel, PanelEmpty, StatusPill } from './kit.jsx';

// Super Admin category management: create, list, view, edit and delete. Deletion never leaves broken
// references: the API refuses while businesses, services or open applications use a category unless
// they are moved to another one, and sub-categories must be moved first.
export default function Categories() {
  useDocumentTitle('Categories');
  const { id } = useParams();
  return id ? <CategoryDetail id={id} /> : <CategoryList />;
}

const EMPTY = { name: '', slug: '', parentId: '', icon: '', description: '', sortOrder: 0, isActive: true, showOnHomepage: true };
const toForm = (c) => ({ ...EMPTY, ...c, parentId: c.parentId ?? '', icon: c.icon ?? '', description: c.description ?? '' });
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function CategoryList() {
  const list = useApi('/admin/categories');
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [q, setQ] = useState('');
  const all = list.data ?? [];
  const parents = all.filter((c) => !c.parentId);
  const match = (c) => !q || `${c.name} ${c.slug}`.toLowerCase().includes(q.toLowerCase());
  const visibleParents = parents.filter((p) => match(p) || all.some((c) => c.parentId === p.id && match(c)));
  return (
    <AdminPage
      width="wide"
      title="Categories"
      description="The service taxonomy customers browse and vendors choose from. The first five published top-level categories appear in the homepage hero."
      actions={
        <>
          <ExportButton path="/admin/categories/export" fallbackName="townant-categories.xlsx" />
          <Button onClick={() => setEditing({ ...EMPTY })} icon={<Plus size={17} aria-hidden="true" />}>
            Add category
          </Button>
        </>
      }
    >
      <DataPanel
        state={list}
        title={list.data ? `${parents.length} top-level · ${all.length - parents.length} sub-categories` : 'Categories'}
        description="In sort order. Sub-categories are listed under their parent."
        filters={<SearchInput label="Search categories" labelHidden={false} placeholder="Name or slug" value={q} onChange={setQ} className="w-full sm:w-72" />}
        empty={<PanelEmpty icon={Tags} title="No categories yet" body="Add the first category customers can browse." />}
      >
        {() =>
          visibleParents.length === 0 ? (
            <PanelEmpty icon={Tags} title="No categories match" body="Try another name or slug." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {visibleParents.map((p) => (
                <li key={p.id} className="px-5 py-4">
                  <CategoryRow c={p} onOpen={() => navigate(`/admin/categories/${p.id}`)} onEdit={() => setEditing(toForm(p))} onDelete={() => setDeleting(p)} />
                  {all.some((c) => c.parentId === p.id) && (
                    <ul className="ml-6 mt-3 flex flex-col gap-1 border-l-2 border-slate-100 pl-4 sm:ml-[4.25rem]">
                      {all
                        .filter((c) => c.parentId === p.id)
                        .map((c) => (
                          <li key={c.id}>
                            <CategoryRow c={c} onOpen={() => navigate(`/admin/categories/${c.id}`)} onEdit={() => setEditing(toForm(c))} onDelete={() => setDeleting(c)} />
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </DataPanel>
      {editing && (
        <CategoryForm
          key={editing.id ?? 'new'}
          initial={editing}
          parents={parents}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            list.reload();
            if (created) navigate(`/admin/categories/${saved.id}`);
            else setEditing(null);
          }}
        />
      )}
      {deleting && <DeleteCategory category={deleting} categories={all} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); list.reload(); }} />}
    </AdminPage>
  );
}

function CategoryRow({ c, onOpen, onEdit, onDelete }) {
  const top = !c.parentId;
  return (
    <div className="flex items-center justify-between gap-3 text-secondary">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition hover:opacity-80">
        {top && (
          <span className="flex h-12 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
            {c.image ? <img src={imageUrl(c.image.url, { w: 112, h: 96 })} alt="" width={56} height={48} loading="lazy" className="size-full object-cover" /> : <ImageOff size={18} aria-label="No image" className="text-slate-300" />}
          </span>
        )}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={top ? 'font-semibold text-slate-900' : 'text-slate-700'}>{c.name}</span>
          <span className="text-caption text-slate-400">/{c.slug}</span>
          {!c.isActive && <StatusPill kind="category" status="unpublished" />}
          {top && c.isActive && !c.image && <Badge>No image</Badge>}
          <span className="inline-flex items-center gap-1 text-caption text-slate-500 tabular">
            <Store size={12} aria-hidden="true" /> {c.companyCount ?? 0}
            <span className="sr-only">businesses</span>
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label={`Edit ${c.name}`} onClick={onEdit}>
          <Pencil size={15} />
        </IconButton>
        <IconButton label={`Delete ${c.name}`} onClick={onDelete} danger>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </div>
  );
}

const IconButton = ({ label, children, danger, ...props }) => (
  <button type="button" aria-label={label} title={label} className={`flex size-9 items-center justify-center rounded-lg transition ${danger ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800'}`} {...props}>
    <span aria-hidden="true">{children}</span>
  </button>
);

function CategoryDetail({ id }) {
  const detail = useApi(`/admin/categories/${id}`);
  const all = useApi('/admin/categories');
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const c = detail.data;
  const crumbs = [{ label: 'Categories', to: '/admin/categories' }, { label: c?.name ?? 'Category' }];
  if (detail.error && !c)
    return (
      <AdminPage title="Category" breadcrumbs={crumbs} width="wide">
        <ErrorState error={detail.error} onRetry={detail.reload} title={detail.error.status === 404 ? 'This category no longer exists' : undefined} />
        <Link to="/admin/categories" className="inline-flex items-center gap-1 text-secondary font-semibold text-teal-700 hover:underline">
          <ArrowLeft size={14} aria-hidden="true" /> All categories
        </Link>
      </AdminPage>
    );
  if (!c) return <DetailSkeleton label="Loading category" />;
  const parents = (all.data ?? []).filter((x) => !x.parentId);
  const togglePublished = async () => {
    try {
      await api(`/admin/categories/${id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
      toast(c.isActive ? 'Category unpublished' : 'Category published');
      detail.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <AdminPage
      width="wide"
      breadcrumbs={crumbs}
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {c.name}
          <StatusPill kind="category" status={c.isActive ? 'published' : 'unpublished'} />
        </span>
      }
      description={`/${c.slug} · ${c.parent ? `Sub-category of ${c.parent.name}` : 'Top-level category'}`}
      actions={
        <>
          {c.isActive && (
            <a href={`/search?category=${c.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-body font-semibold text-teal-700 transition hover:bg-teal-50">
              View on site <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          <Button variant="secondary" onClick={togglePublished} icon={c.isActive ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}>
            {c.isActive ? 'Unpublish' : 'Publish'}
          </Button>
          <Button variant="secondary" onClick={() => setEditing(true)} icon={<Pencil size={16} aria-hidden="true" />}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => setDeleting(true)} icon={<Trash2 size={16} aria-hidden="true" />}>
            Delete
          </Button>
        </>
      }
    >
      {detail.error && <Alert tone="warn">Couldn't refresh — showing the last loaded details.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Businesses', c.usage.companies, 'bg-teal-50 text-teal-700'],
          ['Live businesses', c.usage.liveCompanies, 'bg-sky-50 text-sky-700'],
          ['Services', c.usage.services, 'bg-violet-50 text-violet-700'],
          ['Open applications', c.usage.openApplications, 'bg-amber-50 text-amber-800'],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-slate-200/80 bg-white p-4">
            <span className={`inline-flex rounded-lg px-2 py-0.5 text-caption font-semibold ${tone}`}>{label}</span>
            <p className="mt-2 font-heading text-[1.5rem] font-extrabold text-slate-900 tabular">{value.toLocaleString('en-US')}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Details">
          <FactList
            columns={1}
            items={[
              ['Description', c.description],
              ['Line icon', c.icon ?? 'Default'],
              ['Sort order', String(c.sortOrder)],
              ['Homepage row', c.parentId ? 'Not applicable (sub-category)' : c.showOnHomepage ? 'Shown when it has businesses' : 'Hidden'],
              ['Last updated', c.updatedAt ? formatDate(c.updatedAt) : null],
            ]}
          />
        </Panel>
        {c.parentId ? (
          <Panel title="Parent">
            <Link to={`/admin/categories/${c.parent?.id}`} className="font-semibold text-teal-700 hover:underline">
              {c.parent?.name}
            </Link>
          </Panel>
        ) : (
          <Panel title="Card image" description="Shown on public category cards and in the homepage hero.">
            <CategoryImage key={c.image?.url ?? 'none'} category={c} onSaved={detail.reload} />
          </Panel>
        )}
      </div>
      {!c.parentId && (
        <Panel flush title="Sub-categories" description={c.children.length ? 'Listed under this category for customers and vendors.' : undefined}>
          {c.children.length === 0 ? (
            <PanelEmpty title="No sub-categories" body="Add one from the categories list and choose this category as its parent." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {c.children.map((ch) => (
                <li key={ch.id}>
                  <Link to={`/admin/categories/${ch.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-secondary transition hover:bg-slate-50">
                    <span className="text-slate-800">{ch.name} <span className="text-caption text-slate-400">/{ch.slug}</span></span>
                    {!ch.isActive && <StatusPill kind="category" status="unpublished" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {editing && <CategoryForm initial={toForm(c)} parents={parents} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); detail.reload(); }} />}
      {deleting && <DeleteCategory category={c} categories={all.data ?? []} onClose={() => setDeleting(false)} onDone={() => navigate('/admin/categories', { replace: true })} />}
    </AdminPage>
  );
}

const ICON_OPTIONS = [{ value: '', label: 'Default (grid)' }, ...CATEGORY_ICON_KEYS.map((k) => ({ value: k, label: k }))];

function CategoryForm({ initial, parents, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.id));
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const editingSlug = initial.id && form.slug !== initial.slug;
  const slugOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug) && form.slug.length >= 2;
  const fieldError = (path) => error?.details?.fields?.find((f) => f.path === path)?.message ?? (error?.code === 'SLUG_TAKEN' && path === 'slug' ? error.message : undefined);
  const save = async (e) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const body = { name: form.name.trim(), parentId: form.parentId || null, sortOrder: Number(form.sortOrder) || 0, isActive: form.isActive, showOnHomepage: form.showOnHomepage !== false, description: form.description.trim(), ...(form.icon ? { icon: form.icon } : {}) };
    try {
      if (initial.id) {
        const { data } = await api(`/admin/categories/${initial.id}`, { method: 'PATCH', body: { ...body, ...(form.slug !== initial.slug ? { slug: form.slug.trim() } : {}) } });
        toast('Category saved');
        onSaved(data, false);
      } else {
        const { data } = await api('/admin/categories', { method: 'POST', body: { ...body, slug: form.slug.trim() } });
        toast('Category created. Add an image next.');
        onSaved(data, true);
      }
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={initial.id ? `Edit ${initial.name}` : 'New category'} size="lg">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input
          label="Name"
          required
          maxLength={60}
          value={form.name}
          error={fieldError('name')}
          onChange={(e) => {
            const name = e.target.value;
            setForm((f) => ({ ...f, name, ...(!slugTouched ? { slug: slugify(name) } : {}) }));
          }}
        />
        <Input
          label="Slug"
          required
          maxLength={60}
          value={form.slug}
          error={fieldError('slug') ?? (form.slug && !slugOk ? 'Lowercase letters, numbers and single dashes.' : undefined)}
          onChange={(e) => {
            setSlugTouched(true);
            setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }));
          }}
          hint={editingSlug ? 'Changing the slug breaks existing links to this category.' : 'Used in links, e.g. /search?category=pet-care.'}
        />
        <Select label="Parent" value={form.parentId} onChange={set('parentId')} hint="Sub-categories appear under their parent.">
          <option value="">None (top level)</option>
          {parents
            .filter((p) => p.id !== initial.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
        <Select label="Line icon" value={form.icon} onChange={set('icon')} options={ICON_OPTIONS} hint="Shown when no image is uploaded." />
        <Textarea className="sm:col-span-2" label="Description" optional rows={2} maxLength={300} value={form.description} onChange={set('description')} hint="Shown on the categories page." />
        <Input label="Sort order" type="number" min={0} max={1000} value={form.sortOrder} onChange={set('sortOrder')} hint="Lower numbers appear first." />
        <div className="pt-6">
          <Toggle label="Published" description={form.isActive ? 'Visible to customers and vendors.' : 'Hidden from customers and vendors.'} checked={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
        </div>
        {!form.parentId && (
          <div className="sm:col-span-2">
            <Toggle label="Show a row on the homepage" description={form.showOnHomepage !== false ? 'Kept for the homepage category rows setting.' : 'No homepage row. The category stays browsable and searchable.'} checked={form.showOnHomepage !== false} onChange={(v) => setForm((f) => ({ ...f, showOnHomepage: v }))} />
          </div>
        )}
        <div className="sm:col-span-2">
          <FormError error={error} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" pending={pending} disabled={form.name.trim().length < 2 || !slugOk}>
            {initial.id ? 'Save changes' : 'Create category'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Delete with the dependency rules made visible: sub-categories block deletion; categories in use
// can move their businesses, services and open applications to another published category, or be
// unpublished instead (which hides them without touching any business).
function DeleteCategory({ category, categories, onClose, onDone }) {
  const toast = useToast();
  const usage = useApi(`/admin/categories/${category.id}`);
  const [reassignTo, setReassignTo] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const u = usage.data?.usage;
  const inUse = u ? u.companies + u.services + u.openApplications > 0 : false;
  const targets = categories.filter((c) => c.id !== category.id && c.isActive && c.parentId !== category.id);
  const remove = async () => {
    setPending('delete');
    setError(null);
    try {
      const { data } = await api(`/admin/categories/${category.id}`, { method: 'DELETE', body: inUse ? { reassignTo } : {} });
      toast(data.reassignedTo ? `${category.name} deleted. ${data.moved.companies} business${data.moved.companies === 1 ? '' : 'es'} moved to ${data.reassignedTo.name}.` : `${category.name} deleted`);
      onDone();
    } catch (err) {
      setError(err);
      if (err.code === 'CATEGORY_IN_USE' || err.code === 'CATEGORY_HAS_CHILDREN') usage.reload();
    } finally {
      setPending(null);
    }
  };
  const unpublish = async () => {
    setPending('unpublish');
    setError(null);
    try {
      await api(`/admin/categories/${category.id}`, { method: 'PATCH', body: { isActive: false } });
      toast(`${category.name} unpublished. Businesses keep it; customers no longer see it.`);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${category.name}?`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>
            Cancel
          </Button>
          {u && inUse && category.isActive && (
            <Button variant="secondary" pending={pending === 'unpublish'} disabled={Boolean(pending)} onClick={unpublish}>
              Unpublish instead
            </Button>
          )}
          <Button variant="danger" pending={pending === 'delete'} disabled={!u || u.children > 0 || (inUse && !reassignTo) || Boolean(pending)} onClick={remove}>
            {inUse ? 'Move and delete' : 'Delete category'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-body">
        {usage.error && !u ? (
          <ErrorState compact error={usage.error} onRetry={usage.reload} />
        ) : !u ? (
          <p className="text-slate-500">Checking where this category is used…</p>
        ) : u.children > 0 ? (
          <Alert tone="warn" title="Has sub-categories">
            Move or delete its {u.children} sub-categor{u.children === 1 ? 'y' : 'ies'} first.
          </Alert>
        ) : inUse ? (
          <>
            <p className="text-slate-700">
              Still used by{' '}
              {[u.companies && `${u.companies} business${u.companies === 1 ? '' : 'es'} (${u.liveCompanies} live)`, u.services && `${u.services} service${u.services === 1 ? '' : 's'}`, u.openApplications && `${u.openApplications} open application${u.openApplications === 1 ? '' : 's'}`].filter(Boolean).join(', ')}
              . To delete it, choose where they move. They are moved in one step, so no business is left without a category.
            </p>
            <Select label="Move them to" required value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} options={[{ value: '', label: 'Choose a published category…' }, ...targets.map((t) => ({ value: t.id, label: t.parentId ? `— ${t.name}` : t.name }))]} />
          </>
        ) : (
          <p className="text-slate-700">No business, service or open application uses it. It is removed from the site right away{category.image ? ', together with its image' : ''}. This can't be undone.</p>
        )}
        <FormError error={error} />
      </div>
    </Modal>
  );
}

// Card image for a top-level category. Previewed locally (already resized) before upload; the API re-checks the bytes.
function CategoryImage({ category, onSaved }) {
  const toast = useToast();
  const [alt, setAlt] = useState(category.imageAlt ?? '');
  const [file, setFile] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(false);
  const upload = useImageUpload();
  const preview = useObjectUrl(file);

  const save = async () => {
    try {
      await upload.run(`/admin/categories/${category.id}/image`, file, { alt: alt.trim() });
      setFile(null);
      toast('Image saved. It appears on the public site within a minute.');
      onSaved();
    } catch {
      /* shown below */
    }
  };
  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await api(`/admin/categories/${category.id}/image`, { method: 'DELETE' });
      toast('Image removed');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setRemoving(false);
    }
  };
  const src = preview ?? (category.image ? imageUrl(category.image.url, { w: 640, h: 480 }) : null);
  return (
    <div className="flex flex-col gap-3">
      {src ? (
        <img src={src} alt="" width={640} height={480} className="aspect-[4/3] w-full max-w-sm rounded-xl object-cover ring-1 ring-slate-200" />
      ) : (
        <div className="flex aspect-[4/3] w-full max-w-sm items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-secondary text-slate-500">No image yet. Customers see the category's line icon.</div>
      )}
      <Input label="Image description" optional maxLength={140} value={alt} onChange={(e) => setAlt(e.target.value)} hint="Describe the photo for screen-reader users." />
      <UploadProgress progress={upload.progress} onCancel={upload.cancel} prepared={file ? prepared : null} />
      <div className="flex flex-wrap gap-2">
        <ImagePicker
          maxEdge={1600}
          disabled={upload.pending}
          onPick={(f, info) => {
            setFile(f);
            setPrepared(info);
          }}
          onError={setError}
          label={category.image || file ? 'Choose a different image' : 'Choose an image'}
        />
        {file && (
          <>
            <Button size="sm" pending={upload.pending} onClick={save}>
              Save image
            </Button>
            <Button size="sm" variant="ghost" disabled={upload.pending} onClick={() => setFile(null)}>
              Cancel
            </Button>
          </>
        )}
        {!file && category.image && (
          <Button size="sm" variant="danger-ghost" pending={removing} onClick={remove}>
            Remove image
          </Button>
        )}
      </div>
      <FormError error={error ?? upload.error} />
    </div>
  );
}
