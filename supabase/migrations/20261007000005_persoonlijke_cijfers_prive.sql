-- Teamleden zien elkaars persoonlijke cijfers niet; alleen de student zelf, coaches en admin.
alter policy read_records on public.assessment_records
  using (student_email = public.my_email()
         or (company_id is not null and public.coaches_company(company_id))
         or (company_id is not null and student_email is null and public.in_company(company_id))
         or (student_email is not null and public.coaches_student(student_email))
         or public.is_trusted_admin());
