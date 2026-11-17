output "platform_key_id" {
  value = google_kms_crypto_key.platform["primary"].id
}

output "dr_key_id" {
  value = google_kms_crypto_key.platform["dr"].id
}

output "multi_region_key_id" {
  value = google_kms_crypto_key.platform["geo"].id
}

output "project_number" {
  value = data.google_project.this.number
}

# PR-LDC-60: "<CLASS>.<COMPARTMENT>" => key id in the multi-region ring (empty when off).
output "compartment_key_ids" {
  value = { for s, k in google_kms_crypto_key.compartment : s => k.id }
}
