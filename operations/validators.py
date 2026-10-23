"""Upload checks for Document.file: size, extension, and the file's real type."""
import filetype
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator

MAX_UPLOAD_MB = 10
ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp']

# extension → what filetype reports for the file's magic bytes
_EXPECTED_KIND = {'pdf': 'pdf', 'jpg': 'jpg', 'jpeg': 'jpg', 'png': 'png', 'webp': 'webp'}

validate_file_extension = FileExtensionValidator(
    allowed_extensions=ALLOWED_EXTENSIONS,
    message='نوع فایل «%(extension)s» مجاز نیست. فقط PDF، JPG، PNG و WEBP قبول می‌شود.',
)


def validate_file_size(file):
    if file.size > MAX_UPLOAD_MB * 1024 * 1024:
        raise ValidationError(f'حجم فایل بیشتر از {MAX_UPLOAD_MB} میگابایت است.', code='file_too_large')


def validate_file_magic(file):
    """
    Read the first 261 bytes and check the file's real type. A renamed file
    (e.g. an .exe saved as .jpg) is rejected even though its extension is allowed.
    """
    extension = file.name.rsplit('.', 1)[-1].lower() if '.' in file.name else ''
    position = file.tell() if hasattr(file, 'tell') else 0
    file.seek(0)
    head = file.read(261)
    file.seek(position)
    kind = filetype.guess(head)
    if kind is None or kind.extension != _EXPECTED_KIND.get(extension):
        raise ValidationError('محتوای فایل با نوع آن مطابقت ندارد. فایل خراب یا جعلی است.', code='file_type_mismatch')
