output "role_arns" {
  value = { for sa, r in aws_iam_role.this : sa => r.arn }
}
