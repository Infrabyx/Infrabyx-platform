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
