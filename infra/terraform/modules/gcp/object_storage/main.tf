# One bucket per class (IPB-01 §01.4.7). AUDIT, REGULATED and CONFIDENTIAL are dual-region
# (primary and DR region) with a locked retention policy, the equivalent of Object Lock in
# compliance mode; GENERAL and PUBLIC_ASSETS are regional without one. Every bucket has uniform
# access, public access prevention, versioning and the platform key; GCS serves TLS only.
locals {
  classes = ["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"]
  locked  = { for c in ["AUDIT", "REGULATED", "CONFIDENTIAL"] : c => var.retention_years[c] }
  names   = { for c in local.classes : c => "${var.name}-${replace(lower(c), "_", "-")}" }
}

resource "google_storage_bucket" "this" {
  for_each                    = local.names
  name                        = each.value
  location                    = upper(contains(keys(local.locked), each.key) ? var.multi_region : var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning {
    enabled = true
  }
  encryption {
    default_kms_key_name = contains(keys(local.locked), each.key) ? var.multi_region_key_id : var.key_id
  }
  dynamic "custom_placement_config" {
    for_each = contains(keys(local.locked), each.key) ? [1] : []
    content {
      data_locations = [upper(var.region), upper(var.region_dr)]
    }
  }
  dynamic "retention_policy" {
    for_each = contains(keys(local.locked), each.key) ? [local.locked[each.key]] : []
    content {
      is_locked        = true
      retention_period = retention_policy.value * 31536000
    }
  }
  labels = merge(var.tags, { bucket_class = lower(each.key) })
}
