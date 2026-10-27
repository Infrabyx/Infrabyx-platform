# Service account => Google service account email, for the iam.gke.io/gcp-service-account annotation.
output "emails" {
  value = { for sa, a in google_service_account.this : sa => a.email }
}
