output "buckets" {
  value = { for c, b in google_storage_bucket.this : c => b.name }
}

output "lock_mode" {
  value = "compliance"
}
