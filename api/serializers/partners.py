from partners.models import Trader, TransportCompany

from .base import KabulModelSerializer


class TraderSerializer(KabulModelSerializer):
    class Meta:
        model = Trader
        fields = '__all__'
        digit_fields = ('phone', 'national_id')


class TransportCompanySerializer(KabulModelSerializer):
    class Meta:
        model = TransportCompany
        fields = '__all__'
        digit_fields = ('phone',)
