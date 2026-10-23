import { PartnerPage, type PartnerField } from '@/components/partners/PartnerPage';

// partners.TransportCompany — name is unique (the API answers 400 with a Dari message).
const FIELDS: PartnerField[] = [
  { name: 'name', required: true, maxLength: 160 },
  { name: 'phone', kind: 'phone', maxLength: 40 },
  { name: 'country', maxLength: 80 },
  { name: 'note', kind: 'textarea', maxLength: 2000 },
];

export function TransportCompanies(): JSX.Element {
  return (
    <PartnerPage
      ns="transport_companies"
      endpoint="/transport-companies/"
      base="/partners/transport-companies"
      fields={FIELDS}
      extraColumn="country"
    />
  );
}
