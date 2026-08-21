export function addressDto(address) {
  const value = address.toObject ? address.toObject() : address;
  return {
    id: String(value._id),
    slot: value.slot,
    recipientName: value.recipientName,
    phone: value.phone,
    email: value.email,
    addressLine1: value.addressLine1,
    addressLine2: value.addressLine2 ?? null,
    landmark: value.landmark ?? null,
    city: value.city,
    district: value.district,
    state: value.state,
    pincode: value.pincode,
    isDefault: value.isDefault,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
