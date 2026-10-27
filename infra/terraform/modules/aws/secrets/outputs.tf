output "provider" {
  value = "aws-secrets-manager"
}

output "path_prefix" {
  value = var.path_prefix
}

output "read_policy_arn" {
  value = aws_iam_policy.read.arn
}
