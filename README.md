# Gittrends-app - Geocoder

`gittrends-geocoder` é uma aplicação para resolução de endereços informados por desenvolvedores da plataforma GitHub.

Esse script é necessário uma vez que as localizações informadas são livres, ou seja, cada usuário informa um texto em formato próprio (e.g., Brasil, brazil, br, etc.).

Para isso usamos do [Nominatim](https://nominatim.openstreetmap.org/), uma search engine do OpenStreetMap, para resolver a localização provida em um local padronizado (país, estado, cidade, etc.).

## Como usar

Esta aplicação age cria um servidor local que permite a consulta por outros clients usando do protocolo REST.

```console
docker build github.com/gittrends-app/geocoder -t gittrends/geocoder
docker run --rm -p 3000:80 gittrends/geocoder
```

Após executar o servidor, você poderá consultar localizações fazendo requisições para `/search?q=<localização>`. Por exemplo:

```console
curl http://localhost:3000/search?q=brazil
```

A resposta será:

```json
{ "source": "brazil", "country": "Brazil", "country_code": "BR" }
```

Ou acessar <http://localhost:3000/docs> para navegar pela documentação Swagger do projeto.

## Cache de resultados

Com intuito de otimizar o uso das requisições da API, a aplicação faz uso de uma base que armazena os resultados de consultas anteriores. Assim, antes de realizar a consulta aos serviços externos, a aplicação verifica se a localização já foi resolvida anteriormente. Em caso positivo, ele reutiliza os resultados obtidos. Caso contrário, realiza a consulta a API. Essa abordagem permite acelerar o processo usando de resultados locais.

## Autores

- Hudson Silva Borges ([github](https://github.com/hsborges))
