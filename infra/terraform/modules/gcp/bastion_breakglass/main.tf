# Break-glass (IPB-02): off by default. When enabled, the named members get Kubernetes Engine
# admin through an IAM condition that expires at expires_at, behind the organisation's 2-step
# verification; no bastion host, no SSH.
data "google_client_config" "this" {}

resource "terraform_data" "expiry_check" {
  count = var.enabled ? 1 : 0
  input = var.expires_at
  lifecycle {
    precondition {
      condition     = var.expires_at != ""
      error_message = "Break-glass needs expires_at: the grant is time-bound."
    }
  }
}

resource "google_project_iam_member" "this" {
  for_each = var.enabled ? var.members : {}
  project  = data.google_client_config.this.project
  role     = "roles/container.admin"
  member   = each.value
  condition {
    title       = "break-glass-${var.name}"
    description = "Remove after the incident"
    expression  = "request.time < timestamp(\"${var.expires_at}\")"
  }
}
