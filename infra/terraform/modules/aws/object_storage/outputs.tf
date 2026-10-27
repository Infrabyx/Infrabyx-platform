output "buckets" {
  value = { for c, b in aws_s3_bucket.this : c => b.bucket }
}

output "lock_mode" {
  value = "compliance"
}
