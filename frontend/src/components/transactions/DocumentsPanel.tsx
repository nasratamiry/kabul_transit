import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  History,
  ImageOff,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/DateInput';
import { FormField } from '@/components/ui/FormField';
import { HistoryTimeline } from '@/components/ui/HistoryTimeline';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { api, extractErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dualDateTime, toGregorian, toShamsiKey } from '@/lib/date';
import { normalizeDigits, toDariDigits, useDigitLocale } from '@/lib/digits';
import { DOC_KEY, typeName, useDocumentTypes } from '@/lib/documents';
import { ACCEPT, MAX_UPLOAD_MB, checkUpload, fetchDocumentUrl, formatSize } from '@/lib/files';
import { TX_KEY } from '@/lib/transactionSections';
import type { HistoryEntry, Transaction, TxDocument } from '@/types/api';

const isImage = (doc: TxDocument): boolean => doc.content_type.startsWith('image/');

/**
 * Documents of one transaction: the checklist of document types its branch requires for its
 * trade type, the upload dialog (type, number, issue date, note, several files), the list
 * (open, download, history, delete) and a warning wherever a document's number differs from
 * the transaction's own number field. Missing documents only warn; they never block saving.
 */
export function DocumentsPanel({ tx }: { tx: Transaction }): JSX.Element {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const d = useDigitLocale();
  const { name } = useDocumentTypes();
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<{ type: string; files: File[] } | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [historyOf, setHistoryOf] = useState<TxDocument | null>(null);
  const key = [...DOC_KEY, 'tx', tx.id];

  const docs = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<TxDocument[]>('/documents/', { params: { transaction: tx.id } })).data,
  });

  const status = tx.documents_status;
  const label = (doc: TxDocument): string => typeName(doc.doc_type_names, i18n.language);

  async function refresh(): Promise<void> {
    await qc.invalidateQueries({ queryKey: [...DOC_KEY] });
    await qc.invalidateQueries({ queryKey: [...TX_KEY] }); // count, status, number fields
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragging(false);
    setDialog({ type: '', files: Array.from(e.dataTransfer.files) });
  }

  async function open(doc: TxDocument): Promise<void> {
    if (isImage(doc)) {
      setLightbox({ url: await fetchDocumentUrl(doc.download_url), name: label(doc) });
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
      title: t('documents.delete_title', {
        name: `${label(doc)} ${doc.doc_number}`.trim(),
      }),
      message: t('documents.delete_message'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    await api.delete(`/documents/${doc.id}/`);
    toast.success(t('documents.deleted'));
    await refresh();
  }

  return (
    <Card id="documents" className="scroll-mt-24 p-5 print:hidden" data-testid="documents-panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-brand dark:text-emerald-300">
          {t('documents.title')}{' '}
          {docs.data && <span className="text-gray-500">({d(docs.data.length)})</span>}
        </h2>
        <Button onClick={() => setDialog({ type: '', files: [] })} data-testid="upload-open">
          <UploadCloud className="h-4 w-4" />
          {t('documents.upload_button')}
        </Button>
      </div>

      {/* Checklist: the types this branch requires for this trade type */}
      <section aria-label={t('documents.checklist')} className="mb-4" data-testid="doc-checklist">
        <h3 className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-300">
          {t('documents.checklist')}
        </h3>
        {status.required.length === 0 ? (
          <p className="text-sm text-gray-500">{t('documents.none_required')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {status.required.map((code) => {
              const missing = status.missing.includes(code);
              const numbers = (docs.data ?? [])
                .filter((x) => x.doc_type === code && x.doc_number)
                .map((x) => x.doc_number);
              return (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => missing && setDialog({ type: code, files: [] })}
                    disabled={!missing}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                      missing
                        ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200'
                        : 'cursor-default border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
                    )}
                    data-testid={`checklist-${code}`}
                    data-state={missing ? 'missing' : 'present'}
                  >
                    {missing ? (
                      <XCircle className="h-4 w-4" aria-hidden />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                    )}
                    <span className="font-medium">{name(code)}</span>
                    {numbers.length > 0 && (
                      <span dir="ltr" className="font-mono text-xs">
                        {numbers.join(', ')}
                      </span>
                    )}
                    <span className="sr-only">
                      {missing ? t('documents.missing') : t('documents.present')}
                    </span>
                    {missing && (
                      <span className="text-xs underline">{t('documents.upload_now')}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {status.missing.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">{t('documents.missing_never_blocks')}</p>
        )}
      </section>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'mb-4 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center text-sm',
          dragging
            ? 'border-brand bg-brand-light dark:bg-brand/20'
            : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400',
        )}
        data-testid="dropzone"
      >
        <UploadCloud className="h-6 w-6 text-gray-400" aria-hidden />
        <p>{t('documents.drop_hint')}</p>
      </div>

      {docs.isPending ? (
        <Spinner className="mx-auto h-6 w-6" />
      ) : docs.data?.length ? (
        <ul className="grid gap-3 lg:grid-cols-2" data-testid="document-list">
          {docs.data.map((doc) => {
            const when = dualDateTime(doc.uploaded_at);
            return (
              <li
                key={doc.id}
                className="flex gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                data-testid="document-item"
                data-type={doc.doc_type}
              >
                <button
                  type="button"
                  onClick={() => void open(doc)}
                  className="h-fit shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  aria-label={`${t('documents.open')}: ${label(doc)} ${doc.doc_number}`}
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
                <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand" data-testid="document-type">
                      {label(doc)}
                    </Badge>
                    {doc.doc_number && (
                      <code className="font-mono text-xs" dir="ltr" data-testid="document-number">
                        {doc.doc_number}
                      </code>
                    )}
                  </p>
                  {doc.issue_date && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t('documents.issue_date')}: {toDariDigits(doc.issue_date)}{' '}
                      <span dir="ltr">({toGregorian(doc.issue_date)})</span>
                    </p>
                  )}
                  {doc.note && (
                    <p className="truncate text-xs text-gray-600 dark:text-gray-400" dir="auto">
                      {doc.note}
                    </p>
                  )}
                  <p className="truncate text-xs text-gray-500">
                    <span dir="auto">{doc.file_name}</span> · {formatSize(doc.file_size, d)} ·{' '}
                    {doc.uploaded_by_name || doc.uploaded_by_username || '—'} · {when.shamsi}{' '}
                    <span dir="ltr">({when.gregorian})</span>
                  </p>
                  {doc.number_mismatch && (
                    <p
                      role="alert"
                      className="flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
                      data-testid="number-mismatch"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t('documents.mismatch', {
                        field: t(`form.${doc.number_field}`),
                        value: doc.number_mismatch,
                      })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <IconButton label={t('documents.download')} onClick={() => void download(doc)}>
                    <Download className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t('history.title')}
                    onClick={() => setHistoryOf(doc)}
                    data-testid="document-history"
                  >
                    <History className="h-4 w-4" />
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

      {dialog && (
        <UploadDialog
          tx={tx}
          initialType={dialog.type}
          initialFiles={dialog.files}
          onClose={() => setDialog(null)}
          onUploaded={refresh}
        />
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

      {historyOf && <DocumentHistory doc={historyOf} onClose={() => setHistoryOf(null)} />}
    </Card>
  );
}

interface Pending {
  key: string;
  file: File;
  progress: number; // 0..100
  error?: string;
  done?: boolean;
}

/**
 * Upload dialog: one type / number / issue date / note for one or more files (e.g. the pages
 * of a T1). Files are checked in the browser first (size, type, real content); the server
 * stays the final judge and its Dari message is shown per file.
 */
function UploadDialog({
  tx,
  initialType,
  initialFiles,
  onClose,
  onUploaded,
}: {
  tx: Transaction;
  initialType: string;
  initialFiles: File[];
  onClose(): void;
  onUploaded(): Promise<void>;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const d = useDigitLocale();
  const { active, types } = useDocumentTypes();
  const input = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState(initialType);
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [typeError, setTypeError] = useState(false);

  const selected = types?.find((x) => x.code === docType);
  const numberField = selected?.number_field ?? '';
  const current = numberField ? String(tx[numberField] ?? '') : '';
  const patch = (k: string, change: Partial<Pending>): void =>
    setFiles((list) => list.map((f) => (f.key === k ? { ...f, ...change } : f)));

  function check(list: File[]): Promise<Pending[]> {
    return Promise.all(
      list.map(async (file) => {
        const problem = await checkUpload(file);
        return {
          key: `${file.name}-${file.size}-${Math.random()}`,
          file,
          progress: 0,
          error: problem ? t(problem, { mb: d(MAX_UPLOAD_MB) }) : undefined,
        };
      }),
    );
  }

  async function add(list: File[]): Promise<void> {
    const checked = await check(list);
    setFiles((prev) => [...prev, ...checked]);
  }

  useEffect(() => {
    // The files dropped on the panel, once.
    let alive = true;
    void check(initialFiles).then((checked) => {
      if (alive && checked.length) setFiles((prev) => [...checked, ...prev]);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = files.filter((f) => !f.error && !f.done);

  async function submit(): Promise<void> {
    if (!docType) {
      setTypeError(true);
      return;
    }
    setBusy(true);
    let failed = false;
    for (const item of ready) {
      const body = new FormData();
      body.append('transaction', String(tx.id));
      body.append('doc_type', docType);
      body.append('doc_number', normalizeDigits(number.trim()));
      if (issueDate) body.append('issue_date', toShamsiKey(issueDate) ?? issueDate);
      body.append('note', note.trim());
      body.append('file', item.file);
      try {
        const saved = await api.post<TxDocument>('/documents/', body, {
          skipErrorToast: true,
          onUploadProgress: (e) =>
            patch(item.key, { progress: e.total ? Math.round((e.loaded / e.total) * 100) : 50 }),
        });
        patch(item.key, { done: true, progress: 100 });
        const sync = saved.data.number_sync;
        // Only one file of a batch needs to say it: every file carries the same number.
        if (sync?.status === 'mismatch' && item === ready[0]) {
          toast(
            t('documents.mismatch', {
              field: t(`form.${sync.field}`),
              value: sync.transaction_value,
            }),
            { icon: '⚠️', duration: 9000, id: 'number-mismatch' },
          );
        } else if (sync?.status === 'filled' && item === ready[0]) {
          toast.success(
            t('documents.number_filled', { field: t(`form.${sync.field}`), value: number.trim() }),
            { duration: 7000 },
          );
        }
      } catch (err) {
        failed = true;
        const data = isAxiosError(err) ? err.response?.data : null;
        patch(item.key, { error: extractErrorMessage(data) ?? t('errors.server') });
      }
    }
    setBusy(false);
    await onUploaded();
    if (!failed) {
      toast.success(t('documents.uploaded_n', { n: d(ready.length) }));
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={t('documents.upload_title')}
      size="lg"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={ready.length === 0}
            data-testid="upload-submit"
          >
            <UploadCloud className="h-4 w-4" />
            {t('documents.upload_n', { n: d(ready.length) })}
          </Button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="upload-dialog">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('documents.type')}
            required
            error={typeError && !docType ? 'documents.type_required' : undefined}
          >
            <Select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              placeholder={t('documents.choose_type')}
              options={active.map((x) => ({ value: x.code, label: typeName(x, i18n.language) }))}
              data-testid="doc-type-select"
            />
          </FormField>
          <FormField
            label={t('documents.number')}
            hint={
              numberField
                ? current
                  ? t('documents.number_hint_current', {
                      field: t(`form.${numberField}`),
                      value: current,
                    })
                  : t('documents.number_hint_empty', { field: t(`form.${numberField}`) })
                : undefined
            }
          >
            <Input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              maxLength={60}
              dir="ltr"
              className="font-mono"
              data-testid="doc-number-input"
            />
          </FormField>
          <FormField label={t('documents.issue_date')}>
            <DateInput
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              data-testid="doc-issue-date"
            />
          </FormField>
          <FormField label={t('documents.note')}>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              data-testid="doc-note"
            />
          </FormField>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void add(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center text-sm',
            dragging
              ? 'border-brand bg-brand-light dark:bg-brand/20'
              : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400',
          )}
        >
          <UploadCloud className="h-7 w-7 text-gray-400" aria-hidden />
          <p>{t('documents.drop_hint')}</p>
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
            {t('documents.choose')}
          </Button>
          <p className="text-xs text-gray-500">{t('documents.limits', { mb: d(MAX_UPLOAD_MB) })}</p>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            aria-label={t('documents.choose')}
            onChange={(e) => {
              void add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
            data-testid="file-input"
          />
        </div>

        {files.length > 0 && (
          <ul className="space-y-2" aria-live="polite" data-testid="upload-list">
            {files.map((f) => (
              <li
                key={f.key}
                className="rounded-lg border border-gray-200 p-2 text-sm dark:border-gray-700"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate" dir="auto">
                    {f.file.name}{' '}
                    <span className="text-xs text-gray-500">{formatSize(f.file.size, d)}</span>
                  </span>
                  {f.done ? (
                    <CheckCircle2
                      className="h-4 w-4 text-emerald-600"
                      aria-label={t('common.saved')}
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-gray-500 underline"
                      disabled={busy}
                      onClick={() => setFiles((list) => list.filter((x) => x.key !== f.key))}
                    >
                      {t('documents.remove_file')}
                    </button>
                  )}
                </div>
                {f.error ? (
                  <p
                    role="alert"
                    className="mt-1 text-xs text-red-700 dark:text-red-400"
                    data-testid="upload-error"
                  >
                    {f.error}
                  </p>
                ) : (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${f.progress}%` }}
                      role="progressbar"
                      aria-valuenow={f.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={f.file.name}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Who uploaded / changed this document and when. */
function DocumentHistory({ doc, onClose }: { doc: TxDocument; onClose(): void }): JSX.Element {
  const { t, i18n } = useTranslation();
  const history = useQuery({
    queryKey: [...DOC_KEY, 'history', doc.id],
    queryFn: async () => (await api.get<HistoryEntry[]>(`/documents/${doc.id}/history/`)).data,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('history.title')}: ${typeName(doc.doc_type_names, i18n.language)} ${doc.doc_number}`}
    >
      <div data-testid="document-history-modal">
        <HistoryTimeline
          entries={history.data}
          loading={history.isPending}
          fieldLabel={(f) =>
            i18n.exists(`documents.fields.${f}`) ? t(`documents.fields.${f}`) : undefined
          }
        />
      </div>
    </Modal>
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
