import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/cn';
import { DOC_REQUIREMENTS_KEY, typeName, useDocumentTypes } from '@/lib/documents';
import { useBranches } from '@/lib/finance';
import { toastError } from '@/lib/hooks';
import { TRADE_TYPES, TX_KEY, type TradeType } from '@/lib/transactionSections';
import type { DocumentRequirement } from '@/types/api';

/**
 * «مدیریت → اسناد لازم»: per branch, a checkbox grid — rows are document types, columns the
 * four trade types. A ticked cell makes a transaction without that document show as «سند ناقص»
 * (a warning only; saving is never blocked). Every tick is saved at once, with history.
 */
export function DocumentRequirements(): JSX.Element {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { branches } = useBranches();
  const { types, name } = useDocumentTypes();
  const branch = Number(params.get('branch')) || null;

  // Start on the first branch.
  useEffect(() => {
    const first = branches[0];
    if (!branch && first) setParams({ branch: String(first.id) }, { replace: true });
  }, [branch, branches, setParams]);

  const key = [...DOC_REQUIREMENTS_KEY, branch];
  const rows = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<DocumentRequirement[]>('/document-requirements/', { params: { branch } }),
    enabled: branch !== null,
  });
  const required = new Set(
    (rows.data ?? []).filter((r) => r.required).map((r) => `${r.doc_type_code}|${r.trade_type}`),
  );
  // Ticks not yet confirmed by a refetch. React state, set inside the change event, so the
  // controlled checkbox shows the new value at once (a cache update arrives a tick later).
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const cellKey = (code: string, tt: string): string => `${code}|${tt}`;

  type Cell = { doc_type: string; trade_type: TradeType; required: boolean };
  const toggle = useMutation({
    mutationFn: (cell: Cell) =>
      api.post<DocumentRequirement>(
        '/document-requirements/set/',
        { branch, ...cell },
        { skipErrorToast: true },
      ),
    onError: toastError, // onSettled refetches the real state, which puts the tick back
    onSuccess: (_data, cell) => {
      toast.success(
        t(cell.required ? 'requirements.now_required' : 'requirements.now_optional', {
          type: name(cell.doc_type),
          trade: t(`trade_types.${cell.trade_type}`),
        }),
        { id: 'requirement-saved' },
      );
    },
    onSettled: async (_data, _err, cell) => {
      await qc.invalidateQueries({ queryKey: key });
      setPending((p) => {
        const rest = { ...p };
        delete rest[cellKey(cell.doc_type, cell.trade_type)];
        return rest;
      });
      await qc.invalidateQueries({ queryKey: [...TX_KEY] }); // checklists and «سند ناقص» badges
    },
  });

  function setCell(cell: Cell): void {
    setPending((p) => ({ ...p, [cellKey(cell.doc_type, cell.trade_type)]: cell.required }));
    toggle.mutate(cell);
  }

  return (
    <>
      <PageHeader title={t('requirements.title')} description={t('requirements.description')} />
      <div className="mb-4 max-w-xs">
        <Select
          value={branch ?? ''}
          onChange={(e) => setParams({ branch: e.target.value })}
          aria-label={t('transactions.branch')}
          options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
          data-testid="requirements-branch"
        />
      </div>
      <Card className="overflow-x-auto">
        {!rows.data || !types ? (
          <div className="flex justify-center p-10">
            <Spinner className="h-6 w-6" label={t('common.loading')} />
          </div>
        ) : (
          <table className="w-full min-w-[36rem] text-sm" data-testid="requirements-matrix">
            <caption className="sr-only">{t('requirements.title')}</caption>
            <thead className="bg-gray-50 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              <tr>
                <th scope="col" className="px-4 py-3 text-start">
                  {t('documents.type')}
                </th>
                {TRADE_TYPES.map((tt) => (
                  <th key={tt} scope="col" className="px-4 py-3 text-center">
                    {t(`trade_types.${tt}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {types.map((type) => (
                <tr key={type.id} className={cn(!type.is_active && 'text-gray-400')}>
                  <th scope="row" className="px-4 py-2 text-start font-medium">
                    {typeName(type, i18n.language)}{' '}
                    <code className="font-mono text-xs text-gray-500" dir="ltr">
                      {type.code}
                    </code>
                    {!type.is_active && (
                      <span className="ms-2 text-xs">({t('common.inactive')})</span>
                    )}
                  </th>
                  {TRADE_TYPES.map((tt) => {
                    const k = cellKey(type.code, tt);
                    const checked = pending[k] ?? required.has(k);
                    return (
                      <td key={tt} className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!type.is_active}
                          onChange={(e) =>
                            setCell({
                              doc_type: type.code,
                              trade_type: tt,
                              required: e.target.checked,
                            })
                          }
                          aria-label={`${typeName(type, i18n.language)} — ${t(`trade_types.${tt}`)}`}
                          className="h-5 w-5 cursor-pointer rounded border-gray-300 text-brand focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed"
                          data-testid={`req-${type.code}-${tt}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
        {t('requirements.types_hint')}{' '}
        <Link
          to="/admin/document-types"
          className="font-medium text-brand underline dark:text-emerald-300"
        >
          {t('nav.document_types')}
        </Link>
      </p>
    </>
  );
}
