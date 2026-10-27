# Storage for the in-cluster Loki and Tempo (IPB-01 §01.4.12): one regional bucket with a locked
# 180-day retention policy and the platform key, private like the bucket classes. The apps send
# OTLP to the in-cluster collector only.
resource "google_storage_bucket" "telemetry" {
  name                        = "${var.name}-telemetry"
  location                    = upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning {
    enabled = true
  }
  encryption {
    default_kms_key_name = var.key_id
  }
  retention_policy {
    is_locked        = true
    retention_period = var.log_retention_days * 86400
  }
  labels = merge(var.tags, { bucket_class = "confidential", role = "telemetry" })
}
