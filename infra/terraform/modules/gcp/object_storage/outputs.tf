output "buckets" {
  value = { for c in local.classes : c => google_storage_bucket.this[c].name }
}

output "lock_mode" {
  value = "compliance"
}

# PR-LDC-60: "<CLASS>.<COMPARTMENT>" => its bucket and key, for the settings
# int.storage.bucket.<class>.<compartment> and the adapter's compartment keys. Empty when off.
output "compartments" {
  value = { for s in keys(local.cmp) : s => { bucket = google_storage_bucket.this[s].name, key_id = local.key_of[s] } }
}
