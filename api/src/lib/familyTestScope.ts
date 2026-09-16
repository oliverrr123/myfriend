// A local owner test can enable messaging without contacting other customers.
export function familyTestPhone() {
  return process.env.FAMILY_MESSAGING_TEST_PHONE?.trim() || null;
}
export function familyRecipientAllowed(phone: string) {
  const target = familyTestPhone();
  return target === null || (/^\+[1-9]\d{7,14}$/.test(target) && phone === target);
}
