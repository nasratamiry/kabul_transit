import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { fieldErrors, useApi } from '@/lib/api';
import { toGregorian, todayShamsi } from '@/lib/date';
import { normalizeNumber, toDariDigits } from '@/lib/digits';
import { toastError, useChoices } from '@/lib/hooks';
import { RATES_KEY } from '@/lib/rates';
import type { ExchangeRate } from '@/types/api';

interface TodayRateDialogProps {
  open: boolean;
  onClose(): void;
  /** Called after the rate is saved (e.g. to retry a request that got 428). */
  onSaved?(rate: ExchangeRate): void;
}

const RATE = /^\d{1,6}(\.\d{1,8})?$/;

/**
 * Enter TODAY's rate — the only rate a branch manager may enter (the API refuses other
 * dates). The date is fixed; the currency defaults to USD, the one the 428 soft lock needs.
 */
export function TodayRateDialog({ open, onClose, onSaved }: TodayRateDialogProps): JSX.Element {
  const { t } = useTranslation();
  const api = useApi();
  const qc = useQueryClient();
  const currencies = useChoices('/exchange-rates/', 'currency') ?? [];
  const [currency, setCurrency] = useState('USD');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const today = todayShamsi();

  async function save(): Promise<void> {
    const value = normalizeNumber(rate);
    if (!RATE.test(value) || Number(value) <= 0) {
      setError('rates.rate_invalid');
      return;
    }
    setSaving(true);
    try {
      const saved = await api.post<ExchangeRate>(
        '/exchange-rates/',
        { date: today, currency, rate: value },
        { skipErrorToast: true },
      );
      await qc.invalidateQueries({ queryKey: [...RATES_KEY] });
      toast.success(t('rates.created', { date: toDariDigits(today) }));
      setRate('');
      onClose();
      onSaved?.(saved);
    } catch (err) {
      const errors = fieldErrors(err);
      setError(errors.rate ?? errors.date ?? errors.non_field_errors ?? errors.currency);
      if (!Object.keys(errors).length) toastError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('rates.today_dialog_title')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving} data-testid="today-rate-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
        data-testid="today-rate-dialog"
      >
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/50">
          {t('rates.date')}: <strong>{toDariDigits(today)}</strong>{' '}
          <span className="text-xs text-gray-500" dir="ltr">
            ({toGregorian(today)})
          </span>
          <span className="mt-1 block text-xs text-gray-500">{t('rates.today_only_note')}</span>
        </p>
        <FormField label={t('rates.currency')} required>
          <Select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            options={currencies.map((c) => ({ value: c.value, label: c.display_name }))}
            data-testid="today-rate-currency"
          />
        </FormField>
        <FormField label={t('rates.rate')} hint={t('rates.rate_hint')} error={error} required>
          <Input
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              setError(undefined);
            }}
            inputMode="decimal"
            placeholder="70.00"
            data-autofocus
            data-testid="today-rate-input"
          />
        </FormField>
      </form>
    </Modal>
  );
}
