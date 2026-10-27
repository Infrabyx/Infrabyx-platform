# The output contract (IPB-01 §01.4.9.3; infra/terraform/contract/outputs.schema.json). A product's
# environment stack reads only these, never the provider resources (IPB-01-34).

output "kubeconfig_ref" {
  value = module.kubernetes.kubeconfig_ref
}

output "postgres" {
  value = {
    host                    = module.postgres.host
    port                    = module.postgres.port
    db                      = module.postgres.db
    ssl_mode                = "verify-full"
    credentials_secret_path = module.postgres.credentials_secret_path
  }
}

output "redis" {
  value = {
    url_secret_path = module.redis.url_secret_path
  }
}

output "storage" {
  value = {
    buckets   = module.object_storage.buckets
    lock_mode = module.object_storage.lock_mode
  }
}

output "kms" {
  value = {
    platform_key_id = module.kms.platform_key_id
  }
}

output "secrets" {
  value = {
    provider    = module.secrets.provider
    path_prefix = module.secrets.path_prefix
  }
}

output "edge" {
  value = {
    zone_id         = module.dns_cdn_edge.zone_id
    origin_hostname = module.dns_cdn_edge.origin_hostname
  }
}

output "observability" {
  value = {
    otlp_endpoint = module.observability_backend.otlp_endpoint
  }
}

output "registry" {
  value = {
    url = module.registry.url
  }
}

output "region" {
  value = {
    primary = var.region_primary
    dr      = var.region_dr
  }
}
