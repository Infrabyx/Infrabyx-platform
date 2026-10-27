output "platform_key_arn" {
  value = aws_kms_key.platform.arn
}

output "dr_key_arn" {
  value = aws_kms_replica_key.dr.arn
}
