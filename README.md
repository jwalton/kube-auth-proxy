# kube-auth-proxy

[![NPM version](https://badge.fury.io/js/kube-auth-proxy.svg)](https://npmjs.org/package/kube-auth-proxy)
![Build Status](https://github.com/jwalton/kube-auth-proxy.svg)
[![Coverage Status](https://coveralls.io/repos/jwalton/kube-auth-proxy/badge.svg)](https://coveralls.io/r/jwalton/kube-auth-proxy)

## Description

kube-auth-proxy is a Kubernetes-aware authorizing reverse proxy, designed as
a replacement for oauth2_proxy.

You may have a number of "internal" services, such as Prometheus, Grafana,
Kibana, the Kubernetes dashboard, or others, which you'd like to make available
on the public internet, but which you'd like to control who can access.
kube-auth-proxy tries to make this a fairly painless process.

The basic idea is:

- Install kube-auth-proxy. Configure it with some default authentication and
  authorization.
- Set up an ingress controller which forwards one or more subdomains to kube-auth-proxy
  (e.g. "\*.internal.mydomain.com").
- For each service you want to expose, either add some annotations to that service
  or create a configmap for the service which desicribes what domain it should
  be available on (e.g. "prometheus.internal.mydomain.com" or just "prometheus"),
  and optionally specify some extra authorization criteria for this service.

## Tutorial

Let's suppose we have an internal service in our cluster, say prometheus, and
we want to expose it at prom.internal.mydomain.com.

### Installation and Configuration

Start with `examples/kube-auth-proxy-github.yaml`. Download this file, and update
(at a minimum) `internal.MY-DOMAIN.COM`, `CLIENT-ID-HERE`, `CLIENT-SECRET-HERE`,
and `MY-ORG-HERE`. Apply this with:

```sh
$ kubectl apply -f `./kube-auth-proxy-github.yaml`.
```

### Define an Ingress

We need to create an ingress which forwards "\*.internal.MY-DOMAN.COM" to our
new service. Unlike with oauth2-proxy or other services, kube-auth-proxy doesn't
rely on features built into nginx-ingress, and should work with any ingress.
For example, on AWS an ALB ingress could be as simple as

```yaml
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: kube-auth-proxy-ingress
  namespace: kube-system
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/scheme: internet-facing
spec:
  rules:
    - host: '*.internal.MY-DOMAIN.COM'
      http:
        paths:
          - path: /*
            backend:
              serviceName: kube-auth-proxy
              servicePort: http
```

This will create an ALB listening for https traffic on 443, and will forward all
traffic to kube-auth-proxy.

### Annotate our Internal Service

We'll add some annotations to our service so kube-auth-proxy will find it and route to it:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: prometheus
  labels:
    app: prometheus
  annotations:
    # Expose this as prometheus.internal.MY-DOMAIN.COM
    kube-auth-proxy/host: prometheus
    kube-auth-proxy/targetPort: web
    # Only allow github users in the "devOps" team in the "your-org-name"
    # organization to access this service.
    kube-auth-proxy/githubAllowedTeams: devOps@your-org-name
spec:
  type: ClusterIP
  ports:
    - name: web
      port: 9090
      protocol: TCP
      targetPort: 9090
  selector:
    app: prometheus
```

That's all you need to do! As soon as you create/update this service,
kube-auth-proxy will update it's internal configuration and start forwarding
traffic to your internal service. Only Github authenticated users will
be able to connect.

## Service Annotations

- `kube-auth-proxy/host` - The hostname to assign to the service. This can
  either be just the hostname (e.g. "prometheus") in which case it will combined
  the configured domain (e.g. "prometheus.mycompany.org"), or it can be a FQDN
  (e.g. "promethus.mycompany.org".)
- `kube-auth-proxy/targetPort` - The port to forward traffic to. This can either
  be the name of a port in the service's `ports` section, or it can be a numeric
  port.
- `kube-auth-proxy/bearerTokenSecret` - A reference to a secret, used to populate
  a bearer token header when requests are sent to the target service. For example:

        kube-auth-proxy/bearerTokenSecret: "{secretName: 'mysecret', dataName: 'token'}"

  would find the secret "mysecret" in the same namespace as the service, extract
  value "token", and inject this as a bearer token in an "Authorization"
  header for all requests forwarded to the service.

### Restrictions

Note that if more than one restriction is defined, they are "or"ed together.
In other words, if you specify:

```yaml
annotations:
  kube-auth-proxy/githubAllowedOrganizations: myorg
  kube-auth-proxy/githubAllowedUsers: jwalton
```

then the github user "jwalton" will be allowed to access your service, and anyone
in "myorg" will also be able to access your service (as opposed to the more
restrictive "and" case where only users with the name "jwalton" who are also
members of "myorg" will be allowed to access you service).

- `kube-auth-proxy/githubAllowedOrganizations` - A comma delimited list of
  organization names. Any user who is a member of one of these organizations
  will be allowed to access your service. e.g. "github,benbria". Note that
  this is not case sensitive.
- `kube-auth-proxy/githubAllowedTeams` - A comma delimited list of github
  teams allowed to access this service. Team names are specified as `team@org`.
  For example, if your organization was named "benbria", and you had two teams
  called "dev" and "ops", you could grant access to both these teams with
  "dev@benbria,ops@benbria". Note that this is not case sensitive.
- `kube-auth-proxy/githubAllowedUsers` - A comma delimited list of github
  users allowed to access this service. Note that this is not case sensitive.

## Run locally in minikube

```sh
$ eval $(minikube docker-env)
$ docker build --target release --tag jwalton/kube-auth-proxy .
$ eval $(minikube docker-env -u)
$ kubectl apply -f ./example/kube-auth-proxy-minikube.yaml
$ kubectl --namespace kube-system port-forward svc/kube-auth-proxy 5050:5050
```

And then visit [http://localhost:5050](http://localhost:5050).

Copyright 2019 Jason Walton
