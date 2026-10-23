from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from accounts.models import Branch, User

from .base import KabulModelSerializer


class BranchSerializer(KabulModelSerializer):
    user_count = serializers.SerializerMethodField(label='تعداد کاربران')

    class Meta:
        model = Branch
        fields = '__all__'
        digit_fields = ('code', 'phone')

    def get_user_count(self, obj):
        # Viewsets may annotate user_count to avoid one query per row.
        count = getattr(obj, 'user_count', None)
        return count if count is not None else obj.users.count()


class UserSerializer(KabulModelSerializer):
    """
    All user fields except the password hash. `password` is write-only and is
    hashed with set_password. Who may change role / branch / is_active is
    enforced in the viewset (super admin only).
    """
    password = serializers.CharField(label='رمز عبور', write_only=True, required=False,
                                     style={'input_type': 'password'})
    full_name = serializers.CharField(source='get_full_name', read_only=True, label='نام کامل')

    class Meta:
        model = User
        fields = ('id', 'username', 'password', 'first_name', 'last_name', 'full_name', 'email', 'phone',
                  'role', 'branch', 'is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions',
                  'last_login', 'date_joined')
        read_only_fields = ('is_staff', 'is_superuser', 'groups', 'user_permissions', 'last_login', 'date_joined')
        digit_fields = ('phone',)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        password = attrs.get('password')
        if self.instance is None and not password:
            raise serializers.ValidationError({'password': 'برای کاربر جدید رمز عبور لازم است.'})
        if password:
            candidate = self.instance or User(**{k: v for k, v in attrs.items() if k != 'password'})
            try:
                validate_password(password, candidate)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({'password': exc.messages})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for name, value in validated_data.items():
            setattr(instance, name, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class BranchBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ('id', 'name', 'code')


class MeSerializer(serializers.ModelSerializer):
    """The logged-in user, for the frontend's header and permission checks. Read-only."""
    full_name = serializers.CharField(source='get_full_name', read_only=True)
    branch = BranchBriefSerializer(read_only=True)
    is_super_admin = serializers.BooleanField(read_only=True)
    is_branch_manager = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'full_name', 'role', 'branch', 'is_super_admin', 'is_branch_manager',
                  'is_active', 'last_login')
        read_only_fields = fields
