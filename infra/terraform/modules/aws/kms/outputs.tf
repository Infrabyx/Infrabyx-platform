output "platform_key_arn" {
  value = aws_kms_key.platform.arn
}

output "dr_key_arn" {
  value = aws_kms_replica_key.dr.arn
}

# "<CLASS>.<COMPARTMENT>" => key ARN (empty when no compartment is configured).
output "compartment_key_arns" {
  value = { for s, k in aws_kms_key.compartment : s => k.arn }
}

output "compartment_dr_key_arns" {
  value = { for s, k in aws_kms_replica_key.compartment_dr : s => k.arn }
}

output "compartment_aliases" {
  value = { for s, a in aws_kms_alias.compartment : s => a.name }
}
