output "url" {
  value = split("/", values(aws_ecr_repository.this)[0].repository_url)[0]
}

output "repositories" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}
