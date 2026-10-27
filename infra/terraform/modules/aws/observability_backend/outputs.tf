output "otlp_endpoint" {
  value = var.collector_endpoint
}

output "telemetry_bucket" {
  value = aws_s3_bucket.telemetry.bucket
}
