import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Download, FileText, ImageOff, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/confirm-context';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { api, extractErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dualDateTime } from '@/lib/date';
import { useDigitLocale } from '@/lib/digits';
import { ACCEPT, MAX_UPLOAD_MB, checkUpload, fetchDocumentUrl, formatSize } from '@/lib/files';
import { TX_KEY } from '@/lib/transactionSections';
import type { TxDocument } from '@/types/api';

interface Upload {
  key: string;
  name: string;
  progress: number; // 0..100
  error?: string;
}

const isImage = (doc: TxDocument): boolean => doc.content_type.startsWith('image/');

/** Documents of one transaction: list, upload (drag & drop, several at once), open, delete. */
export function DocumentsPanel({ transactionId }: { transactionId: number }): JSX.Element {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const d = useDigitLocale();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const key = ['documents', transactionId];

  const docs = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<TxDocument[]>('/documents/', { params: { transaction: transactionId } })).data,
  });

  const patch = (k: string, change: Partial<Upload>): void =>
    setUploads((list) => list.map((u) => (u.key === k ? { ...u, ...change } : u)));

  async function uploadOne(file: File): Promise<void> {
    const k = `${file.name}-${file.size}-${Math.random()}`;
    setUploads((list) => [...list, { key: k, name: file.name, progress: 0 }]);
    const problem = await checkUpload(file);
    if (problem) {
      patch(k, { error: t(problem, { mb: d(MAX_UPLOAD_MB) }) });
      return;
    }
    const body = new FormData();
    body.append('transaction', String(transactionId));
    body.append('title', file.name.replace(/\.[^.]+$/, ''));
    body.append('file', file);
    try {
      await api.post('/documents/', body, {
        skipErrorToast: true,
        onUploadProgress: (e) =>
          patch(k, { progress: e.total ? Math.round((e.loaded / e.total) * 100) : 50 }),
      });
      setUploads((list) => list.filter((u) => u.key !== k));
      toast.success(t('documents.uploaded', { name: file.name }));
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: [...TX_KEY] }); // documents_count in lists
    } catch (err) {
      // The server is the final judge: show its Dari message (size, type, forged content).
      const message = isAxiosError(err) ? extractErrorMessage(err.response?.data) : null;
      patch(k, { error: message ?? t('errors.server') });
    }
  }

  function addFiles(files: FileList | null): void {
    for (const file of Array.from(files ?? [])) void uploadOne(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function open(doc: TxDocument): Promise<void> {
    if (isImage(doc)) {
      setLightbox({ url: await fetchDocumentUrl(doc.download_url), name: doc.file_name });
      return;
    }
    // Open the tab first (inside the click), then point it at the file once fetched:
    // a window.open after an await is treated as a popup and blocked.
    const tab = window.open('', '_blank');
    const url = await fetchDocumentUrl(doc.download_url);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  }

  async function download(doc: TxDocument): Promise<void> {
    const url = await fetchDocumentUrl(doc.download_url, true);
    const a = Object.assign(document.createElement('a'), { href: url, download: doc.file_name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function remove(doc: TxDocument): Promise<void> {
    const ok = await confirm({
      title: t('documents.delete_title', { name: doc.title || doc.file_name }),
      message: t('documents.delete_message'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    await api.delete(`/documents/${doc.id}/`);
    toast.success(t('documents.deleted'));
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: [...TX_KEY] });
  }

  return (
    <Card id="documents" className="scroll-mt-24 p-5 print:hidden" data-testid="documents-panel">
      <h2 className="mb-4 font-semibold text-brand dark:text-emerald-300">
        {t('documents.title')}{' '}
        {docs.data && <span className="text-gray-500">({d(docs.data.length)})</span>}
      </h2>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'mb-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm',
          dragging
            ? 'border-brand bg-brand-light dark:bg-brand/20'
            : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400',
        )}
        data-testid="dropzone"
      >
        <UploadCloud className="h-8 w-8 text-gray-400" aria-hidden />
        <p>{t('documents.drop_hint')}</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="rounded-lg bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          {t('documents.choose')}
        </button>
        <p className="text-xs text-gray-500">{t('documents.limits', { mb: d(MAX_UPLOAD_MB) })}</p>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          aria-label={t('documents.choose')}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
          data-testid="file-input"
        />
      </div>

      {uploads.length > 0 && (
        <ul className="mb-4 space-y-2" aria-live="polite" data-testid="upload-list">
          {uploads.map((u) => (
            <li
              key={u.key}
              className="rounded-lg border border-gray-200 p-2 text-sm dark:border-gray-700"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate" dir="auto">
                  {u.name}
                </span>
                {u.error ? (
                  <button
                    type="button"
                    className="text-xs text-gray-500 underline"
                    onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  >
                    {t('common.close')}
                  </button>
                ) : (
                  <span className="tabular-nums text-xs text-gray-500">{d(u.progress)}٪</span>
                )}
              </div>
              {u.error ? (
                <p
                  role="alert"
                  className="mt-1 text-xs text-red-700 dark:text-red-400"
                  data-testid="upload-error"
                >
                  {u.error}
                </p>
              ) : (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: `${u.progress}%` }}
                    role="progressbar"
                    aria-valuenow={u.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={u.name}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {docs.isPending ? (
        <Spinner className="mx-auto h-6 w-6" />
      ) : docs.data?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="document-list">
          {docs.data.map((doc) => {
            const when = dualDateTime(doc.uploaded_at);
            return (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 p-2 dark:border-gray-700"
                data-testid="document-item"
              >
                <button
                  type="button"
                  onClick={() => void open(doc)}
                  className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  aria-label={`${t('documents.open')}: ${doc.title || doc.file_name}`}
                  data-testid="document-open"
                >
                  {isImage(doc) ? (
                    <Thumbnail doc={doc} />
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-md bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                      <FileText className="h-7 w-7" aria-hidden />
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium" dir="auto">
                    {doc.title || doc.file_name}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {formatSize(doc.file_size, d)} · {doc.uploaded_by_name || '—'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {when.shamsi} <span dir="ltr">({when.gregorian})</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <IconButton label={t('documents.download')} onClick={() => void download(doc)}>
                    <Download className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t('common.delete')}
                    tone="danger"
                    onClick={() => void remove(doc)}
                    data-testid="document-delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-gray-500" data-testid="documents-empty">
          {t('documents.empty')}
        </p>
      )}

      <Modal
        open={lightbox !== null}
        onClose={() => {
          if (lightbox) URL.revokeObjectURL(lightbox.url);
          setLightbox(null);
        }}
        title={lightbox?.name ?? ''}
        size="lg"
      >
        {lightbox && (
          <img
            src={lightbox.url}
            alt={lightbox.name}
            className="mx-auto max-h-[70vh]"
            data-testid="lightbox-image"
          />
        )}
      </Modal>
    </Card>
  );
}

/** Image thumbnail fetched with the token (an <img src> to the API would not send it). */
function Thumbnail({ doc }: { doc: TxDocument }): JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    fetchDocumentUrl(doc.download_url)
      .then((u) => {
        url = u;
        if (alive) setState({ url: u, failed: false });
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setState({ url: null, failed: true }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.download_url]);

  if (state.failed) {
    return (
      <span className="flex h-14 w-14 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700">
        <ImageOff className="h-6 w-6 text-gray-400" aria-label={t('documents.thumb_failed')} />
      </span>
    );
  }
  return state.url ? (
    <img
      src={state.url}
      alt=""
      className="h-14 w-14 rounded-md object-cover"
      data-testid="document-thumb"
    />
  ) : (
    <span className="block h-14 w-14 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700" />
  );
}
