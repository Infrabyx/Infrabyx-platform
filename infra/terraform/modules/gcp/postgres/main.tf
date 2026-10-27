# PostgreSQL 18 on Cloud SQL (IPB-01 §01.4.9.1): private IP only, TLS required (verify-full in the
# apps), IAM database authentication, the platform key, regional HA from staging up, point-in-time
# recovery with backups kept in the DR region, deletion protection, and connection and lock logs.
resource "google_sql_database_instance" "this" {
  name                = var.name
  region              = var.region
  database_version    = "POSTGRES_18"
  encryption_key_name = var.key_id
  deletion_protection = true
  settings {
    tier                        = var.tier
    edition                     = "ENTERPRISE"
    availability_type           = var.high_availability ? "REGIONAL" : "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = var.disk_size_gb
    disk_autoresize             = true
    deletion_protection_enabled = true
    user_labels                 = var.tags
    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      ssl_mode                                      = "ENCRYPTED_ONLY"
      enable_private_path_for_google_cloud_services = true
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "20:30"
      location                       = var.region_dr
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = var.backup_retention_days
        retention_unit   = "COUNT"
      }
    }
    # Written out, not generated, so that the policy scanners see them.
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }
    database_flags {
      name  = "log_connections"
      value = "on"
    }
    database_flags {
      name  = "log_disconnections"
      value = "on"
    }
    database_flags {
      name  = "log_checkpoints"
      value = "on"
    }
    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }
    database_flags {
      name  = "log_temp_files"
      value = "0"
    }
    insights_config {
      query_insights_enabled = true
    }
    maintenance_window {
      day  = 7
      hour = 21
    }
  }
}

resource "google_sql_database" "this" {
  name     = var.db_name
  instance = google_sql_database_instance.this.name
}
