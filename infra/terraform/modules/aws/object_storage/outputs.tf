output "buckets" {
  value = { for c in local.classes : c => aws_s3_bucket.this[c].bucket }
}

output "lock_mode" {
  value = "compliance"
}

# PR-LDC-60: "<CLASS>.<COMPARTMENT>" => its bucket and key, for the settings
# int.storage.bucket.<class>.<compartment> and the adapter's compartmentKmsKeyIds. Empty when off.
output "compartments" {
  value = { for s in keys(local.cmp) : s => { bucket = aws_s3_bucket.this[s].bucket, key_id = local.key_of[s] } }
}
