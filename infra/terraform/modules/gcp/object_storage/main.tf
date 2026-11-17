# One bucket per class (IPB-01 §01.4.7). AUDIT, REGULATED and CONFIDENTIAL are dual-region
# (primary and DR region) with a locked retention policy, the equivalent of Object Lock in
# compliance mode; GENERAL and PUBLIC_ASSETS are regional without one. Every bucket has uniform
# access, public access prevention, versioning and the platform key, or a compartment's own key (PR-LDC-60); GCS serves TLS only.
locals {
  classes        = ["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"]
  locked_classes = { for c in ["AUDIT", "REGULATED", "CONFIDENTIAL"] : c => var.retention_years[c] }
  class_names    = { for c in local.classes : c => "${var.name}-${replace(lower(c), "_", "-")}" }

  # PR-LDC-60 (R1-D-158): a compartment location "<CLASS>.<COMPARTMENT>" gets a bucket of its own
  # with every control of its class (dual-region, locked retention, uniform access, public access
  # prevention, versioning) under its own key in place of the platform key. Off by default.
  cmp_abbrev = { REGULATED = "reg", CONFIDENTIAL = "conf", BOARD_CONFIDENTIAL = "board", SEALED = "sealed" }
  cmp        = { for p in var.storage_compartments : "${p.class}.${p.compartment}" => p }
  cmp_names  = { for s, p in local.cmp : s => "${var.name}-${local.cmp_abbrev[p.class]}-${local.cmp_abbrev[p.compartment]}" }

  # Every bucket, keyed by its location: the five classes, then the compartments. The class keys
  # are unchanged, so adding compartments never moves an existing bucket.
  names  = merge(local.class_names, local.cmp_names)
  locked = merge(local.locked_classes, { for s, p in local.cmp : s => var.retention_years[p.class] })
  key_of = merge(
    { for c in local.classes : c => contains(keys(local.locked_classes), c) ? var.multi_region_key_id : var.key_id },
    { for s in keys(local.cmp) : s => lookup(var.compartment_key_ids, s, "") },
  )
  slot_labels = { for s in keys(local.names) : s => merge(
    { bucket_class = lower(split(".", s)[0]) },
    length(split(".", s)) > 1 ? { compartment = lower(replace(split(".", s)[1], "_", "-")) } : {},
  ) }
}

# A compartment's key exists and is its own: never the platform key, never another compartment's
# (the STORAGE adapter refuses the same at start-up).
resource "terraform_data" "compartment_keys" {
  for_each = local.cmp
  input    = each.key
  lifecycle {
    precondition {
      condition     = length(distinct(values(local.key_of))) == length(local.cmp) + length(distinct([var.key_id, var.multi_region_key_id]))
      error_message = "PR-LDC-60: every compartment location has its own key, distinct from the platform keys and from every other compartment's."
    }
  }
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
    default_kms_key_name = local.key_of[each.key]
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
  labels = merge(var.tags, local.slot_labels[each.key])
}
