import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { DocumentType, TxDocument } from '@/types/api';

import { useApi } from './api';

/** react-query key prefix for every document list (panel, register). */
export const DOC_KEY = ['documents'] as const;
export const DOC_TYPES_KEY = ['document-types'] as const;
export const DOC_REQUIREMENTS_KEY = ['document-requirements'] as const;

type Names = Pick<DocumentType, 'name_fa' | 'name_ps' | 'name_en'>;

/** A document type's name in the UI language (Pashto / English fall back to Dari). */
export function typeName(names: Names | TxDocument['doc_type_names'], lang: string): string {
  const n = 'fa' in names ? names : { fa: names.name_fa, ps: names.name_ps, en: names.name_en };
  if (lang === 'ps') return n.ps || n.fa;
  if (lang === 'en') return n.en || n.fa;
  return n.fa;
}

/**
 * Every document type (active and not), in sort order, with a code → name lookup in the
 * current language. Company-wide and rarely changed: cached for 5 minutes.
 */
export function useDocumentTypes(): {
  types: DocumentType[] | undefined;
  active: DocumentType[];
  name(code: string): string;
} {
  const api = useApi();
  const { i18n } = useTranslation();
  const list = useQuery({
    queryKey: [...DOC_TYPES_KEY],
    queryFn: () => api.get<DocumentType[]>('/document-types/'),
    staleTime: 5 * 60_000,
  });
  const types = list.data;
  return {
    types,
    active: (types ?? []).filter((x) => x.is_active),
    name: (code) => {
      const found = types?.find((x) => x.code === code);
      return found ? typeName(found, i18n.language) : code;
    },
  };
}
