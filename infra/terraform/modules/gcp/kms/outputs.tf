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
