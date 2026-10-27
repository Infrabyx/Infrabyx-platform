# One Google service account per Kubernetes service account, impersonable only by that service
# account through Workload Identity, with read access to this environment's secrets only
# (IPB-02-28): Secret Manager accessor under a condition on the secret name prefix.
data "google_client_config" "this" {}
data "google_project" "this" {}

locals {
  short = replace(var.name, "infrabyx-", "ibx-")
  extra = merge([
    # Keyed by position, as on AWS.
    for sa, roles in var.workloads : { for i, r in roles : "${sa}|${i}" => { sa = sa, role = r } }
  ]...)
}

resource "google_service_account" "this" {
  for_each     = var.workloads
  account_id   = "${local.short}-${each.key}"
  display_name = "${each.key} (${var.name})"
}

resource "google_service_account_iam_member" "workload_identity" {
  for_each           = var.workloads
  service_account_id = google_service_account.this[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.workload_pool}[${var.namespace}/${each.key}]"
}

resource "google_project_iam_member" "secrets" {
  for_each = var.workloads
  project  = data.google_client_config.this.project
  role     = "roles/secretmanager.secretAccessor"
  member   = "serviceAccount:${google_service_account.this[each.key].email}"
  condition {
    title      = "${var.secrets_path_prefix}-only"
    expression = "resource.name.startsWith(\"projects/${data.google_project.this.number}/secrets/${var.secrets_path_prefix}-\")"
  }
}

resource "google_project_iam_member" "extra" {
  for_each = local.extra
  project  = data.google_client_config.this.project
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.this[each.value.sa].email}"
}
