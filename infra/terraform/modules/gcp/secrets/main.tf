# The environment's secrets (IPB-02-28): Secret Manager secrets without a version, replicated to
# the primary and DR regions under the platform key there. Their values are written by the
# bootstrap, never by OpenTofu, so none is in state; the workload service accounts read
# <path_prefix>-* only (iam_workload_identity).
resource "google_secret_manager_secret" "this" {
  for_each  = toset(["db-app-rw", "redis-url", "k8s-kubeconfig"])
  secret_id = "${var.path_prefix}-${each.key}"
  labels    = var.tags
  replication {
    user_managed {
      replicas {
        location = var.region
        customer_managed_encryption {
          kms_key_name = var.key_id
        }
      }
      replicas {
        location = var.region_dr
        customer_managed_encryption {
          kms_key_name = var.dr_key_id
        }
      }
    }
  }
}
