# Artifact Registry for the images (IPB-01 §01.4.9.1): Docker format with immutable tags, the
# platform key, and untagged versions cleaned up. The nodes pull with artifactregistry.reader.
data "google_client_config" "this" {}

resource "google_artifact_registry_repository" "this" {
  repository_id = "${var.name}-images"
  location      = var.region
  format        = "DOCKER"
  description   = "Images of ${var.name}"
  kms_key_name  = var.key_id
  labels        = var.tags
  docker_config {
    immutable_tags = true
  }
  cleanup_policies {
    id     = "untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "${var.untagged_retention_days * 86400}s"
    }
  }
}
