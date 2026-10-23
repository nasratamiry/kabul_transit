import { PartnerPage, type PartnerField } from '@/components/partners/PartnerPage';

// partners.Trader — max lengths from the model; note is a TextField (2000 after sanitizing).
const FIELDS: PartnerField[] = [
  { name: 'name', required: true, maxLength: 120 },
  { name: 'company_name', maxLength: 160 },
  { name: 'phone', kind: 'phone', maxLength: 40 },
  { name: 'national_id', kind: 'digits', maxLength: 60 },
  { name: 'address', maxLength: 255 },
  { name: 'note', kind: 'textarea', maxLength: 2000 },
];

export function Traders(): JSX.Element {
  return (
    <PartnerPage
      ns="traders"
      endpoint="/traders/"
      base="/partners/traders"
      fields={FIELDS}
      extraColumn="address"
    />
  );
}
