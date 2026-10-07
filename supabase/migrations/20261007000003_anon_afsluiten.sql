-- Niet-ingelogde bezoekers hoeven geen van de functies aan te roepen.
revoke execute on function public.my_role(), public.my_email(), public.is_trusted_admin(),
  public.coaches_company(uuid), public.coaches_student(text), public.in_company(uuid),
  public.create_pairing_code(), public.pair_admin_device(text, text), public.touch_admin_device(),
  public.device_token_hash()
from public, anon;
grant execute on function public.my_role(), public.my_email(), public.is_trusted_admin(),
  public.coaches_company(uuid), public.coaches_student(text), public.in_company(uuid),
  public.create_pairing_code(), public.pair_admin_device(text, text), public.touch_admin_device(),
  public.device_token_hash()
to authenticated;
