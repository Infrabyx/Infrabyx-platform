# One storage account per bucket class (IPB-01 §01.4.7), each with one private container,
# `objects`. AUDIT, REGULATED and CONFIDENTIAL are geo-zone-redundant (their copies sit in the
# paired DR region) with an account-level immutability policy, which once locked is the
# equivalent of Object Lock in compliance mode (Azure creates it unlocked; immutability_locked
# locks it in the next apply); GENERAL and PUBLIC_ASSETS are zone-redundant without one. Every account
# is private, versioned, HTTPS and TLS 1.2 only, Entra ID only (no shared keys), and encrypted
# with the platform key, or a compartment's own key (PR-LDC-60).
locals {
  classes        = ["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"]
  abbrev         = { AUDIT = "audit", REGULATED = "reg", CONFIDENTIAL = "conf", GENERAL = "gen", PUBLIC_ASSETS = "pub" }
  locked_classes = { for c in ["AUDIT", "REGULATED", "CONFIDENTIAL"] : c => var.retention_years[c] }
  # Account names are 3 to 24 lower-case letters and digits.
  compact     = replace(replace(var.name, "infrabyx-", "ibx"), "-", "")
  class_names = { for c in local.classes : c => "${local.compact}${local.abbrev[c]}" }

  # PR-LDC-60 (R1-D-158): a compartment location "<CLASS>.<COMPARTMENT>" gets an account of its
  # own with every control of its class (GZRS, the immutability policy and its lock switch,
  # private, versioned, Entra ID only) under its own key in place of the platform key. The name
  # ends in b (BOARD_CONFIDENTIAL) or s (SEALED), for example ibxudfprodconfb. Off by default.
  cmp       = { for p in var.storage_compartments : "${p.class}.${p.compartment}" => p }
  cmp_names = { for s, p in local.cmp : s => "${local.compact}${local.abbrev[p.class]}${p.compartment == "SEALED" ? "s" : "b"}" }

  # Every account, keyed by its location: the five classes, then the compartments. The class
  # keys are unchanged, so adding compartments never moves an existing account.
  names     = merge(local.class_names, local.cmp_names)
  slot_tags = { for s in keys(local.names) : s => merge({ bucket_class = split(".", s)[0] }, length(split(".", s)) > 1 ? { compartment = split(".", s)[1] } : {}) }
  locked    = merge(local.locked_classes, { for s, p in local.cmp : s => var.retention_years[p.class] })
  key_of    = merge({ for c in local.classes : c => var.key_id }, { for s in keys(local.cmp) : s => lookup(var.compartment_key_ids, s, "") })
}

# A compartment's key is its own: never the platform key, never another compartment's (the
# STORAGE adapter refuses the same at start-up). An account name over Azure's 24 characters is
# refused by the provider when the configuration is validated, before anything is created.
resource "terraform_data" "compartment_keys" {
  for_each = local.cmp
  input    = each.key
  lifecycle {
    precondition {
      condition     = length(distinct(values(local.key_of))) == length(local.key_of) - length(local.classes) + 1
      error_message = "PR-LDC-60: every compartment location has its own key, distinct from the platform key and from every other compartment's."
    }
  }
}

resource "azurerm_storage_account" "this" {
  for_each                          = local.names
  name                              = each.value
  resource_group_name               = var.resource_group_name
  location                          = var.location
  account_kind                      = "StorageV2"
  account_tier                      = "Standard"
  account_replication_type          = contains(keys(local.locked), each.key) ? "GZRS" : "ZRS"
  min_tls_version                   = "TLS1_2"
  https_traffic_only_enabled        = true
  allow_nested_items_to_be_public   = false
  shared_access_key_enabled         = false
  default_to_oauth_authentication   = true
  cross_tenant_replication_enabled  = false
  infrastructure_encryption_enabled = true
  public_network_access             = "Enabled"
  identity {
    type         = "UserAssigned"
    identity_ids = [var.cmk_identity_id]
  }
  customer_managed_key {
    key_vault_key_id          = local.key_of[each.key]
    user_assigned_identity_id = var.cmk_identity_id
  }
  network_rules {
    default_action             = "Deny"
    bypass                     = ["AzureServices"]
    virtual_network_subnet_ids = var.allowed_subnet_ids
    ip_rules                   = var.admin_cidrs
  }
  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }
  dynamic "immutability_policy" {
    for_each = contains(keys(local.locked), each.key) ? [local.locked[each.key]] : []
    content {
      state                         = var.immutability_locked ? "Locked" : "Unlocked"
      period_since_creation_in_days = immutability_policy.value * 365
      allow_protected_append_writes = false
    }
  }
  tags = merge(var.tags, local.slot_tags[each.key])
}

resource "azurerm_storage_container" "objects" {
  for_each              = local.names
  name                  = "objects"
  storage_account_id    = azurerm_storage_account.this[each.key].id
  container_access_type = "private"
}

resource "azurerm_management_lock" "this" {
  for_each   = local.names
  name       = "${each.value}-lock"
  scope      = azurerm_storage_account.this[each.key].id
  lock_level = "CanNotDelete"
  notes      = "Deletion protection (IPB-01 §01.4.9.1); covers the containers"
}
