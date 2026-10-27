output "otlp_endpoint" {
  value = var.collector_endpoint
}

output "telemetry_bucket" {
  value = google_storage_bucket.telemetry.name
}
