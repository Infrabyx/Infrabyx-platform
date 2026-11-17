# The platform key (IPB-01 §01.4.9.1, IPB-02): HSM-protected and rotated every 90 days, in three
# key rings because a CMEK key must sit where the data does: the primary region, the DR region
# (the secret replicas), and the multi-region of the dual-region buckets. Each Google service
# agent that encrypts with it is granted encrypt and decrypt on these keys only.
data "google_project" "this" {}

locals {
  rings = { primary = var.region, dr = var.region_dr, geo = var.multi_region }
  pn    = data.google_project.this.number
  agents = {
    storage  = "service-${local.pn}@gs-project-accounts.iam.gserviceaccount.com"
    sql      = "service-${local.pn}@gcp-sa-cloud-sql.iam.gserviceaccount.com"
    gke      = "service-${local.pn}@container-engine-robot.iam.gserviceaccount.com"
    compute  = "service-${local.pn}@compute-system.iam.gserviceaccount.com"
    registry = "service-${local.pn}@gcp-sa-artifactregistry.iam.gserviceaccount.com"
    redis    = "service-${local.pn}@cloud-redis.iam.gserviceaccount.com"
    secrets  = "service-${local.pn}@gcp-sa-secretmanager.iam.gserviceaccount.com"
  }
  grants = { for p in setproduct(keys(local.rings), keys(local.agents)) : "${p[0]}|${p[1]}" => { ring = p[0], agent = p[1] } }
}

resource "google_kms_key_ring" "this" {
  for_each = local.rings
  name     = "${var.name}-${each.key}"
  location = each.value
}

resource "google_kms_crypto_key" "platform" {
  for_each        = local.rings
  name            = "platform"
  key_ring        = google_kms_key_ring.this[each.key].id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s"
  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "HSM"
  }
  labels = var.tags
}

resource "google_kms_crypto_key_iam_member" "agents" {
  for_each      = local.grants
  crypto_key_id = google_kms_crypto_key.platform[each.value.ring].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${local.agents[each.value.agent]}"
}

# PR-LDC-60 (R1-D-158): one key per storage compartment location, the same kind as the platform
# key (HSM, rotated every 90 days) and never shared with it or with another compartment. Only in
# the multi-region ring: compartments exist in the locked classes, whose buckets are dual-region
# and must use a key in that location. Only the storage service agent may encrypt and decrypt
# with them. Off by default.
locals {
  cmp_abbrev = { REGULATED = "reg", CONFIDENTIAL = "conf", BOARD_CONFIDENTIAL = "board", SEALED = "sealed" }
  cmp_keys   = { for s in var.compartments : s => join("-", [for x in split(".", s) : local.cmp_abbrev[x]]) }
}

resource "google_kms_crypto_key" "compartment" {
  for_each        = local.cmp_keys
  name            = each.value
  key_ring        = google_kms_key_ring.this["geo"].id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s"
  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "HSM"
  }
  labels = merge(var.tags, { compartment = lower(replace(replace(each.key, ".", "-"), "_", "-")) })
}

resource "google_kms_crypto_key_iam_member" "compartment_storage" {
  for_each      = local.cmp_keys
  crypto_key_id = google_kms_crypto_key.compartment[each.key].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${local.agents.storage}"
}
